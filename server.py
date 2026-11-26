#!/usr/bin/env python3
"""LAN Chat: HTTP + WebSocket signaling on one port; media stays peer-to-peer."""
import asyncio
import hmac
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid

from aiohttp import web, WSMsgType

ROOM_KEY = web.AppKey("room", object)
RTC_KEY = web.AppKey("rtc_config", dict)
ORIGINS_KEY = web.AppKey("public_origins", set)
PASSWORD_KEY = web.AppKey("password", str)

BASE_DIR = Path(__file__).resolve().parent
HOST = os.environ.get('LAN_CHAT_HOST', '0.0.0.0')
PORT = int(os.environ.get('LAN_CHAT_PORT', '8765'))


def local_ip():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(('8.8.8.8', 80))
            return sock.getsockname()[0]
        except OSError:
            return '127.0.0.1'


def load_rtc_config():
    """Public browser config. Prefer short-lived TURN credentials in production."""
    raw = os.environ.get('LAN_CHAT_ICE_SERVERS', '[{"urls":"stun:stun.l.google.com:19302"}]')
    servers = json.loads(raw)
    if not isinstance(servers, list) or any(not isinstance(s, dict) or not s.get('urls') for s in servers):
        raise ValueError('LAN_CHAT_ICE_SERVERS doit être une liste JSON de serveurs ICE')
    budget = int(os.environ.get('LAN_CHAT_VIDEO_BUDGET', '40000000'))
    if budget < 100000:
        raise ValueError('LAN_CHAT_VIDEO_BUDGET doit être au moins 100000 bits/s')
    return {'iceServers': servers, 'mediaTopology': 'mesh', 'videoBudget': budget}


class Room:
    def __init__(self):
        self.users = {}
        self.sockets = {}
        self.tokens = {}
        self.messages = []
        self.broadcast_lock = asyncio.Lock()

    def users_payload(self):
        users = list(self.users.values())
        return {'type': 'users', 'users': users,
                'voice_users': [{'id': u['id'], 'name': u['name']} for u in users if u['in_voice']],
                'screen_users': [{'id': u['id'], 'name': u['name']} for u in users if u['sharing_screen']]}

    def snapshot(self):
        """Full state, sent once to a socket that joins. Later changes are deltas."""
        return {**self.users_payload(), 'type': 'state', 'messages': self.messages[-200:]}

    async def broadcast(self, payload=None):
        async with self.broadcast_lock:
            data = payload or self.users_payload()
            async def deliver(ws):
                try:
                    await asyncio.wait_for(ws.send_json(data), 5)
                except (ConnectionError, RuntimeError, asyncio.TimeoutError):
                    await ws.close()
            await asyncio.gather(*(deliver(ws) for ws in list(self.sockets.values()) if not ws.closed))


async def index(request):
    return web.Response(text=(BASE_DIR / 'index.html').read_text(encoding='utf-8'),
                        content_type='text/html', headers={'Cache-Control': 'no-store'})


async def media_script(request):
    return web.FileResponse(BASE_DIR / 'media.js', headers={'Cache-Control': 'no-store'})


def password_ok(app, supplied):
    expected = app[PASSWORD_KEY]
    return not expected or hmac.compare_digest(expected.encode(), supplied.encode())


async def config(request):
    app = request.app
    public = {'mediaTopology': app[RTC_KEY]['mediaTopology'], 'passwordRequired': bool(app[PASSWORD_KEY])}
    # ICE servers may carry TURN credentials: only hand them to clients that know the password.
    if password_ok(app, request.headers.get('X-Room-Password', '')):
        public.update(app[RTC_KEY])
    return web.json_response(public, headers={'Cache-Control': 'no-store'})


def check_origin(request):
    """Allow same-origin websocket, including access via the HTTPS tunnel."""
    from urllib.parse import urlsplit
    origin = request.headers.get('Origin')
    if origin and urlsplit(origin).netloc != request.host and origin not in request.app[ORIGINS_KEY]:
        raise web.HTTPForbidden(text='Origine non autorisée')


def valid_token(value):
    return 16 <= len(value) <= 100 and all(c.isalnum() or c in '-_' for c in value)


def clean_name(value, fallback):
    return str(value or '').strip()[:40] or fallback


async def handle_presence(room, ws, cid, data, first):
    user = {'id': cid, 'name': clean_name(data.get('name'), 'Utilisateur'),
            'pc': 'Navigateur', 'in_voice': data.get('in_voice') is True,
            'sharing_screen': data.get('sharing_screen') is True,
            'receive_screens': data.get('receive_screens', True) is True}
    changed = room.users.get(cid) != user
    if changed:
        room.users[cid] = user
    if first:
        await ws.send_json(room.snapshot())
    if changed:
        await room.broadcast()


async def handle_signal(room, ws, cid, data):
    target = room.sockets.get(data.get('target'))
    signal = data.get('signal')
    if target is not None and target is not ws and isinstance(signal, dict):
        await target.send_json({'type': 'signal', 'from': cid, 'signal': signal})


async def handle_chat(room, cid, data):
    """Chat actions; the sender is always the authenticated socket's identity."""
    user = room.users[cid]
    kind = data['type']
    if kind == 'message':
        text = str(data.get('text', '')).strip()[:2000]
        if not text:
            raise ValueError('Message vide')
        room.messages.append({'msg_id': 'msg_' + uuid.uuid4().hex, 'id': cid,
                              'name': user['name'], 'pc': user['pc'], 'text': text,
                              'time': time.time(), 'reactions': {}})
        del room.messages[:-200]
        await room.broadcast({'type': 'message', 'message': room.messages[-1]})
        return
    elif kind == 'react':
        emoji = str(data.get('emoji', '')).strip()[:64]
        if not emoji:
            raise ValueError('Emoji vide')
        for msg in room.messages:
            if msg['msg_id'] == data.get('msg_id'):
                names = msg['reactions'].setdefault(emoji, [])
                # Reactions are stored by client id so homonyms and renames stay correct.
                if cid in names:
                    names.remove(cid)
                else:
                    names.append(cid)
                if not names:
                    del msg['reactions'][emoji]
                await room.broadcast({'type': 'reactions', 'msg_id': msg['msg_id'], 'reactions': msg['reactions']})
                break
        return


async def websocket(request):
    check_origin(request)
    cid = request.query.get('client', '')
    token = request.query.get('token', '')
    if not cid or len(cid) > 100 or not all(c.isalnum() or c in '-_' for c in cid) or not valid_token(token):
        raise web.HTTPBadRequest(text='Identifiant invalide')
    room = request.app[ROOM_KEY]
    ws = web.WebSocketResponse(heartbeat=15, max_msg_size=131072)
    await ws.prepare(request)
    if not password_ok(request.app, request.query.get('password', '')):
        await ws.close(code=4004, message=b'Mot de passe requis')
        return ws
    # The first connection claims an identity with a secret token that is never broadcast.
    # Only the holder of that token can use the id again (reconnection) or speak as it.
    known = room.tokens.setdefault(cid, token)
    if not hmac.compare_digest(known.encode(), token.encode()):
        await ws.close(code=4003, message=b'Jeton invalide')
        return ws
    previous = room.sockets.get(cid)
    room.sockets[cid] = ws
    if previous is not None and not previous.closed:
        # Same owner reconnecting (e.g. after a network drop): the new socket wins.
        await previous.close(code=4001, message=b'Session reprise')
    synced = False
    try:
        async for message in ws:
            if message.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(message.data)
                if not isinstance(data, dict):
                    raise ValueError('Objet attendu')
                kind = data.get('type')
                if kind == 'presence':
                    await handle_presence(room, ws, cid, data, not synced)
                    synced = True
                elif cid not in room.users:
                    raise ValueError('Rejoignez le salon')
                elif kind == 'signal':
                    await handle_signal(room, ws, cid, data)
                elif kind in ('message', 'react'):
                    await handle_chat(room, cid, data)
                else:
                    raise ValueError('Type inconnu')
            except (ValueError, TypeError, ConnectionError, RuntimeError) as error:
                await ws.send_json({'type': 'error', 'error': str(error) or 'Message invalide'})
    finally:
        if room.sockets.get(cid) is ws:
            room.sockets.pop(cid, None)
            room.users.pop(cid, None)
            # Keep the token while the identity still owns messages in the history.
            if not any(m['id'] == cid for m in room.messages):
                room.tokens.pop(cid, None)
            await asyncio.shield(room.broadcast())
    return ws


async def cleanup(app):
    await asyncio.gather(*(ws.close(code=1001, message=b'Server shutdown') for ws in list(app[ROOM_KEY].sockets.values())))


def create_app():
    app = web.Application(client_max_size=131072)
    app[ROOM_KEY] = Room()
    app[RTC_KEY] = load_rtc_config()
    app[PASSWORD_KEY] = os.environ.get('LAN_CHAT_PASSWORD', '')
    app[ORIGINS_KEY] = {value.strip().rstrip('/') for value in os.environ.get('LAN_CHAT_PUBLIC_ORIGINS', '').split(',') if value.strip()}
    app.router.add_get('/', index)
    app.router.add_get('/config', config)
    app.router.add_get('/media.js', media_script)
    app.router.add_get('/ws', websocket)
    app.on_shutdown.append(cleanup)
    return app


async def tunnel_lifecycle(app):
    if os.environ.get('LAN_CHAT_TUNNEL', '0') != '1':
        yield
        return
    process = None
    task = None
    if not app[PASSWORD_KEY]:
        print('⚠️  Tunnel public actif sans LAN_CHAT_PASSWORD : le salon est ouvert à quiconque a le lien.', flush=True)
    try:
        process = subprocess.Popen(['ssh', '-T', '-p', '443', '-o', 'StrictHostKeyChecking=accept-new',
                                    '-o', 'ServerAliveInterval=30', f'-R0:localhost:{PORT}',
                                    '-L4300:localhost:4300', 'free.pinggy.io'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def discover():
            try:
                with urllib.request.urlopen('http://localhost:4300/urls', timeout=1) as response:
                    return json.load(response).get('urls', [])
            except Exception:
                return []
        async def announce():
            for _ in range(20):
                urls = await asyncio.to_thread(discover)
                for url in urls:
                    if url.startswith('https://'):
                        app[ORIGINS_KEY].add(url.rstrip('/'))
                        print(f'🌐 Lien à partager : {url}', flush=True)
                        return
                await asyncio.sleep(1)
            print('Tunnel : URL indisponible. Le salon local reste accessible.', flush=True)
        task = asyncio.create_task(announce())
    except FileNotFoundError:
        print('SSH introuvable : tunnel désactivé.', flush=True)
    try:
        yield
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if process and process.poll() is None:
            process.terminate()
            try:
                await asyncio.to_thread(process.wait, 3)
            except subprocess.TimeoutExpired:
                process.kill()
                await asyncio.to_thread(process.wait)


if __name__ == '__main__':
    application = create_app()
    application.cleanup_ctx.append(tunnel_lifecycle)
    print(f'💬 LAN Chat · http://localhost:{PORT}\n🏠 LAN : http://{local_ip()}:{PORT}', flush=True)
    web.run_app(application, host=HOST, port=PORT, access_log=None)

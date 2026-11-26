#!/usr/bin/env python3
"""LAN Chat: HTTP + WebSocket signaling on one port; media stays peer-to-peer."""
import asyncio
import hmac
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from aiohttp import WSMsgType, web

ROOM_KEY = web.AppKey("room", object)
RTC_KEY = web.AppKey("rtc_config", dict)
ORIGINS_KEY = web.AppKey("public_origins", set)
PASSWORD_KEY = web.AppKey("password", str)

# When frozen by PyInstaller the bundled data files live under sys._MEIPASS.
BASE_DIR = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
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


SEND_TIMEOUT = 5          # seconds a single send may take before the peer is dropped
MAX_QUEUE = 200           # messages waiting for one slow peer before it is dropped

# (burst, refill per second) per connection and kind of message.
RATE_LIMITS = {'chat': (10, 2.0), 'presence': (20, 5.0), 'signal': (300, 150.0)}
MAX_VIOLATIONS = 50


class TokenBucket:
    def __init__(self, capacity, rate):
        self.capacity, self.rate = capacity, rate
        self.tokens, self.stamp = float(capacity), time.monotonic()

    def allow(self):
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.stamp) * self.rate)
        self.stamp = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


class Client:
    """One websocket with its own outgoing queue.

    Every send is queued and written by a dedicated task, so message order is kept
    per peer while a slow or stuck peer can never delay the others or the sender.
    """

    def __init__(self, ws, max_queue=MAX_QUEUE):
        self.ws = ws
        self.queue = asyncio.Queue(max_queue)
        self.task = asyncio.create_task(self._writer())

    def send(self, payload):
        self.send_text(json.dumps(payload))

    def send_text(self, text):
        try:
            self.queue.put_nowait(text)
        except asyncio.QueueFull:
            # The peer cannot keep up: drop it; it will reconnect and resync.
            asyncio.ensure_future(self.ws.close(code=1013, message=b'Trop lent'))

    async def _writer(self):
        try:
            while True:
                await asyncio.wait_for(self.ws.send_str(await self.queue.get()), SEND_TIMEOUT)
        except (TimeoutError, ConnectionError, RuntimeError):
            await self.ws.close()

    def stop(self):
        self.task.cancel()


class Room:
    def __init__(self):
        self.users = {}
        self.sockets = {}   # client id -> Client
        self.tokens = {}
        self.messages = []

    def users_payload(self):
        users = list(self.users.values())
        return {'type': 'users', 'users': users,
                'voice_users': [{'id': u['id'], 'name': u['name']} for u in users if u['in_voice']],
                'screen_users': [{'id': u['id'], 'name': u['name']} for u in users if u['sharing_screen']]}

    def snapshot(self):
        """Full state, sent once to a socket that joins. Later changes are deltas."""
        return {**self.users_payload(), 'type': 'state', 'messages': self.messages[-200:]}

    def broadcast(self, payload=None):
        text = json.dumps(payload or self.users_payload())
        for client in list(self.sockets.values()):
            client.send_text(text)


async def index(request):
    return web.Response(text=(BASE_DIR / 'index.html').read_text(encoding='utf-8'),
                        content_type='text/html', headers={'Cache-Control': 'no-store'})


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


def handle_presence(room, client, cid, data, first):
    user = {'id': cid, 'name': clean_name(data.get('name'), 'Utilisateur'),
            'pc': 'Navigateur', 'in_voice': data.get('in_voice') is True,
            'sharing_screen': data.get('sharing_screen') is True,
            'receive_screens': data.get('receive_screens', True) is True}
    changed = room.users.get(cid) != user
    if changed:
        room.users[cid] = user
    if first:
        client.send(room.snapshot())
    if changed:
        room.broadcast()


def handle_signal(room, client, cid, data):
    target = room.sockets.get(data.get('target'))
    signal = data.get('signal')
    if target is not None and target is not client and isinstance(signal, dict):
        target.send({'type': 'signal', 'from': cid, 'signal': signal})


def handle_chat(room, cid, data):
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
        room.broadcast({'type': 'message', 'message': room.messages[-1]})
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
                room.broadcast({'type': 'reactions', 'msg_id': msg['msg_id'], 'reactions': msg['reactions']})
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
    client = Client(ws)
    previous = room.sockets.get(cid)
    room.sockets[cid] = client
    if previous is not None and not previous.ws.closed:
        # Same owner reconnecting (e.g. after a network drop): the new socket wins.
        await previous.ws.close(code=4001, message=b'Session reprise')
    synced = False
    buckets = {kind: TokenBucket(*limit) for kind, limit in RATE_LIMITS.items()}
    violations = 0
    last_warning = 0.0
    try:
        async for message in ws:
            if message.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(message.data)
                if not isinstance(data, dict):
                    raise ValueError('Objet attendu')
                kind = data.get('type')
                bucket = buckets['presence' if kind == 'presence' else 'signal' if kind == 'signal' else 'chat']
                if not bucket.allow():
                    violations += 1
                    if violations > MAX_VIOLATIONS:
                        await ws.close(code=4008, message=b'Trop de requetes')
                        break
                    if time.monotonic() - last_warning > 1:
                        last_warning = time.monotonic()
                        client.send({'type': 'error', 'error': 'Trop de messages, ralentissez'})
                    continue
                if kind == 'presence':
                    handle_presence(room, client, cid, data, not synced)
                    synced = True
                elif cid not in room.users:
                    raise ValueError('Rejoignez le salon')
                elif kind == 'signal':
                    handle_signal(room, client, cid, data)
                elif kind in ('message', 'react'):
                    handle_chat(room, cid, data)
                else:
                    raise ValueError('Type inconnu')
            except (ValueError, TypeError) as error:
                client.send({'type': 'error', 'error': str(error) or 'Message invalide'})
    finally:
        # No await here: the handler may already be cancelled when the peer disconnects.
        client.stop()
        if room.sockets.get(cid) is client:
            room.sockets.pop(cid, None)
            room.users.pop(cid, None)
            # Keep the token while the identity still owns messages in the history.
            if not any(m['id'] == cid for m in room.messages):
                room.tokens.pop(cid, None)
            room.broadcast()
    return ws


async def cleanup(app):
    clients = list(app[ROOM_KEY].sockets.values())
    await asyncio.gather(*(client.ws.close(code=1001, message=b'Server shutdown') for client in clients))


async def no_store_static(request, response):
    """Always serve the latest front-end files after an update."""
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-store'


def create_app():
    app = web.Application(client_max_size=131072)
    app[ROOM_KEY] = Room()
    app[RTC_KEY] = load_rtc_config()
    app[PASSWORD_KEY] = os.environ.get('LAN_CHAT_PASSWORD', '')
    origins = os.environ.get('LAN_CHAT_PUBLIC_ORIGINS', '').split(',')
    app[ORIGINS_KEY] = {value.strip().rstrip('/') for value in origins if value.strip()}
    app.router.add_get('/', index)
    app.router.add_get('/config', config)
    app.router.add_static('/static', BASE_DIR / 'static')
    app.on_response_prepare.append(no_store_static)
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

"""HTTP routes and the WebSocket connection loop."""
import hmac
import json
import time
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web

from .config import BASE_DIR, ORIGINS_KEY, PASSWORD_KEY, ROOM_KEY, RTC_KEY
from .handlers import handle_chat, handle_presence, handle_signal, handle_typing, valid_token
from .images import sniff_type
from .room import MAX_VIOLATIONS, RATE_LIMITS, UPLOAD_LIMIT, Client, TokenBucket


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
    origin = request.headers.get('Origin')
    if origin and urlsplit(origin).netloc != request.host and origin not in request.app[ORIGINS_KEY]:
        raise web.HTTPForbidden(text='Origine non autorisée')


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
                bucket = buckets[kind if kind in RATE_LIMITS else 'chat']
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
                elif kind == 'typing':
                    handle_typing(room, cid)
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
            room.upload_buckets.pop(cid, None)
            # Keep the token while the identity still owns messages in the history.
            if not any(m['id'] == cid for m in room.messages):
                room.tokens.pop(cid, None)
            room.broadcast()
    return ws


def authenticated_client(request):
    """The client id behind an HTTP request (same secret token as its WebSocket), or an HTTP error."""
    app, room = request.app, request.app[ROOM_KEY]
    if not password_ok(app, request.headers.get('X-Room-Password', '')):
        raise web.HTTPForbidden(text='Mot de passe requis')
    cid = request.headers.get('X-Client-Id', '')
    token = request.headers.get('X-Token', '')
    known = room.tokens.get(cid)
    if not known or not hmac.compare_digest(known.encode(), token.encode()) or cid not in room.users:
        raise web.HTTPForbidden(text='Rejoignez le salon')
    return cid


async def upload_image(request):
    """Store one image (raw body) in memory; the id is then attached to a chat message over the WebSocket."""
    check_origin(request)
    room = request.app[ROOM_KEY]
    cid = authenticated_client(request)
    if not room.upload_buckets.setdefault(cid, TokenBucket(*UPLOAD_LIMIT)).allow():
        raise web.HTTPTooManyRequests(text='Trop d\'images, patientez un instant')
    data = await request.read()  # larger than client_max_size raises 413 before we get here
    content_type = sniff_type(data)
    if not data or content_type is None:
        raise web.HTTPUnsupportedMediaType(text='Format non pris en charge (JPEG, PNG, GIF, WebP)')
    return web.json_response({'id': room.images.add(cid, data, content_type)})


async def serve_image(request):
    """Images are addressed by an unguessable id, and only the room's members ever see those ids."""
    item = request.app[ROOM_KEY].images.get(request.match_info['image_id'])
    if not item:
        raise web.HTTPNotFound()
    return web.Response(body=item['data'], content_type=item['type'], headers={
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Cross-Origin-Resource-Policy': 'same-origin'})


async def no_store_static(request, response):
    """Always serve the latest front-end files after an update."""
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-store'

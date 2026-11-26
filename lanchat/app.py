"""Application factory."""
import asyncio
import os

from aiohttp import web

from .config import BASE_DIR, ORIGINS_KEY, PASSWORD_KEY, ROOM_KEY, RTC_KEY, load_rtc_config
from .room import Room
from .routes import config, index, no_store_static, websocket


async def close_clients(app):
    clients = list(app[ROOM_KEY].sockets.values())
    await asyncio.gather(*(client.ws.close(code=1001, message=b'Server shutdown') for client in clients))


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
    app.on_shutdown.append(close_clients)
    return app

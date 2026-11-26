"""Settings read from the environment, and the keys used to store them on the aiohttp app."""
import json
import os
import socket
import sys
from pathlib import Path

from aiohttp import web

ROOM_KEY = web.AppKey("room", object)
RTC_KEY = web.AppKey("rtc_config", dict)
ORIGINS_KEY = web.AppKey("public_origins", set)
PASSWORD_KEY = web.AppKey("password", str)

# Project root. When frozen by PyInstaller the bundled data files live under sys._MEIPASS.
BASE_DIR = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
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

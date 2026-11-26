#!/usr/bin/env python3
"""LAN Chat: HTTP + WebSocket signaling on one port; media stays peer-to-peer.

Run this file to start the server. The implementation lives in the lanchat package.
"""
from aiohttp import web

from lanchat.app import create_app
from lanchat.config import HOST, PORT, local_ip
from lanchat.room import Client, Room
from lanchat.tunnel import tunnel_lifecycle

__all__ = ['Client', 'Room', 'create_app', 'main']


def main():
    app = create_app()
    app.cleanup_ctx.append(tunnel_lifecycle)
    print(f'💬 LAN Chat · http://localhost:{PORT}\n🏠 LAN : http://{local_ip()}:{PORT}', flush=True)
    web.run_app(app, host=HOST, port=PORT, access_log=None)


if __name__ == '__main__':
    main()

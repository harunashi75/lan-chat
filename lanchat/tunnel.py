"""Optional public HTTPS link through a Pinggy SSH tunnel (LAN_CHAT_TUNNEL=1)."""
import asyncio
import json
import os
import subprocess
import urllib.request

from .config import ORIGINS_KEY, PASSWORD_KEY, PORT

PINGGY_API = 'http://localhost:4300/urls'


def _start_ssh():
    return subprocess.Popen(
        ['ssh', '-T', '-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30',
         f'-R0:localhost:{PORT}', '-L4300:localhost:4300', 'free.pinggy.io'],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _discover_urls():
    try:
        with urllib.request.urlopen(PINGGY_API, timeout=1) as response:
            return json.load(response).get('urls', [])
    except Exception:
        return []


async def _announce(app):
    """Wait for the tunnel to publish its HTTPS URL, allow it as an origin and print it."""
    for _ in range(20):
        for url in await asyncio.to_thread(_discover_urls):
            if url.startswith('https://'):
                app[ORIGINS_KEY].add(url.rstrip('/'))
                print(f'🌐 Lien à partager : {url}', flush=True)
                return
        await asyncio.sleep(1)
    print('Tunnel : URL indisponible. Le salon local reste accessible.', flush=True)


async def _stop(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        await asyncio.to_thread(process.wait, 3)
    except subprocess.TimeoutExpired:
        process.kill()
        await asyncio.to_thread(process.wait)


async def tunnel_lifecycle(app):
    """aiohttp cleanup context: start the tunnel with the app and stop it on shutdown."""
    if os.environ.get('LAN_CHAT_TUNNEL', '0') != '1':
        yield
        return
    if not app[PASSWORD_KEY]:
        print('⚠️  Tunnel public actif sans LAN_CHAT_PASSWORD : le salon est ouvert à quiconque a le lien.',
              flush=True)
    process = task = None
    try:
        process = _start_ssh()
        task = asyncio.create_task(_announce(app))
    except FileNotFoundError:
        print('SSH introuvable : tunnel désactivé.', flush=True)
    try:
        yield
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if process:
            await _stop(process)

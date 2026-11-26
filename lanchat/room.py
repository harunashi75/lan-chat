"""Room state and per-connection helpers: send queue (Client) and rate limiting (TokenBucket)."""
import asyncio
import json
import time

from .images import ImageStore

SEND_TIMEOUT = 5          # seconds a single send may take before the peer is dropped
MAX_QUEUE = 200           # messages waiting for one slow peer before it is dropped

# (burst, refill per second) per connection and kind of message.
UPLOAD_LIMIT = (5, 0.3)   # burst of 5 images, then one every ~3 s, per client
RATE_LIMITS = {'chat': (10, 2.0), 'presence': (20, 5.0), 'signal': (300, 150.0), 'typing': (6, 1.0)}
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
        self.images = ImageStore()
        self.upload_buckets = {}  # client id -> TokenBucket for /upload

    def add_message(self, message):
        """Append to the history (last 200 kept) and free the images of the messages that fall off."""
        self.messages.append(message)
        for old in self.messages[:-200]:
            if old.get('image'):
                self.images.delete(old['image']['id'])
        del self.messages[:-200]

    def users_payload(self):
        users = list(self.users.values())
        return {'type': 'users', 'users': users,
                'voice_users': [{'id': u['id'], 'name': u['name']} for u in users if u['in_voice']],
                'screen_users': [{'id': u['id'], 'name': u['name']} for u in users if u['sharing_screen']]}

    def snapshot(self):
        """Full state, sent once to a socket that joins. Later changes are deltas."""
        return {**self.users_payload(), 'type': 'state', 'messages': self.messages[-200:]}

    def broadcast(self, payload=None, exclude=None):
        """Queue a payload for everyone (default: the user list), optionally except one client id."""
        text = json.dumps(payload or self.users_payload())
        for cid, client in list(self.sockets.items()):
            if cid != exclude:
                client.send_text(text)

"""In-memory storage for images shared in the chat, with hard limits on size and total memory."""
import time
import uuid
from collections import OrderedDict

MAX_IMAGE_BYTES = 3 * 1024 * 1024        # one image (the browser downsizes before uploading)
STORE_LIMIT_BYTES = 64 * 1024 * 1024     # all images together; the oldest are evicted first
PENDING_TTL = 300                        # seconds an uploaded image may wait to be attached to a message


def sniff_type(data):
    """Detect the real image type from the first bytes. Never trust the client's Content-Type."""
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


class ImageStore:
    def __init__(self, limit=STORE_LIMIT_BYTES):
        self.limit = limit
        self.items = OrderedDict()  # id -> {data, type, owner, used, time}
        self.total = 0

    def add(self, owner, data, content_type):
        self._drop_stale_pending()
        image_id = uuid.uuid4().hex
        self.items[image_id] = {'data': data, 'type': content_type, 'owner': owner, 'used': False, 'time': time.time()}
        self.total += len(data)
        while self.total > self.limit and len(self.items) > 1:
            self.delete(next(iter(self.items)))  # oldest first (never the one just added)
        return image_id

    def claim(self, image_id, owner):
        """Attach an uploaded image to a message. Only its uploader can, and only once."""
        item = self.items.get(image_id)
        if not item or item['owner'] != owner or item['used']:
            return False
        item['used'] = True
        return True

    def get(self, image_id):
        return self.items.get(image_id)

    def delete(self, image_id):
        item = self.items.pop(image_id, None)
        if item:
            self.total -= len(item['data'])

    def _drop_stale_pending(self):
        cutoff = time.time() - PENDING_TTL
        for image_id in [i for i, item in self.items.items() if not item['used'] and item['time'] < cutoff]:
            self.delete(image_id)

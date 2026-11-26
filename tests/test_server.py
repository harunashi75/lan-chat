import asyncio
import io
import json
import os
import unittest

from aiohttp import WSMsgType
from aiohttp.test_utils import AioHTTPTestCase

from lanchat.images import ImageStore
from server import Client, Room, create_app


class SignalingTests(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    async def connect(self, cid, token=None, **presence):
        ws = await self.client.ws_connect(f'/ws?client={cid}&token={token or cid.ljust(16, "x")}')
        await ws.send_json({'type': 'presence', 'name': cid, **presence})
        await self.state_with(ws, lambda d: any(u['id'] == cid for u in d['users']))
        return ws

    async def close_of(self, ws):
        async with asyncio.timeout(3):
            while True:
                message = await ws.receive()
                if message.type != WSMsgType.TEXT:
                    return message

    async def delta(self, ws, kind):
        async with asyncio.timeout(3):
            while True:
                data = await ws.receive_json()
                if data.get('type') == kind:
                    return data

    async def state_with(self, ws, predicate):
        async with asyncio.timeout(3):
            while True:
                data = await ws.receive_json()
                if data.get('type') in ('state', 'users') and predicate(data):
                    return data

    async def test_join_signal_message_reaction_and_disconnect(self):
        alice = await self.connect('alice', sharing_screen=True)
        bob = await self.connect('bob', receive_screens=False)
        state = await self.state_with(alice, lambda d: len(d['users']) == 2)
        self.assertEqual(state['screen_users'], [{'id': 'alice', 'name': 'alice'}])
        self.assertFalse(next(u for u in state['users'] if u['id'] == 'bob')['receive_screens'])
        await alice.send_json({'type': 'signal', 'from': 'forged', 'target': 'bob',
                               'signal': {'candidate': {'candidate': 'test'}}})
        signal = await self.delta(bob, 'signal')
        self.assertEqual(signal['from'], 'alice')
        self.assertEqual(signal['type'], 'signal')
        await alice.send_json({'type': 'message', 'id': 'bob', 'name': 'forged', 'text': 'Bonjour'})
        delta = await self.delta(bob, 'message')
        self.assertEqual(delta['message']['name'], 'alice')
        self.assertEqual(delta['message']['id'], 'alice')
        mid = delta['message']['msg_id']
        for expected in ({'👍': ['bob']}, {}):
            await bob.send_json({'type': 'react', 'msg_id': mid, 'emoji': '👍'})
            delta = await self.delta(bob, 'reactions')
            self.assertEqual((delta['msg_id'], delta['reactions']), (mid, expected))
        await alice.close()
        state = await self.state_with(bob, lambda d: len(d['users']) == 1)
        self.assertEqual(state['screen_users'], [])
        await bob.close()

    async def test_token_protects_identity_and_allows_takeover(self):
        alice = await self.connect('alice', token='secret-token-alice')
        # Another client cannot claim a connected identity without its token.
        thief = await self.client.ws_connect('/ws?client=alice&token=stolen-token-12345')
        message = await thief.receive()
        self.assertEqual((message.type, message.data), (WSMsgType.CLOSE, 4003))
        # The owner reconnecting with the same token replaces the stale socket.
        again = await self.client.ws_connect('/ws?client=alice&token=secret-token-alice')
        message = await self.close_of(alice)
        self.assertEqual((message.type, message.data), (WSMsgType.CLOSE, 4001))
        await again.send_json({'type': 'presence', 'name': 'alice'})
        await self.state_with(again, lambda d: len(d['users']) == 1)
        # The identity stays protected while it owns messages after disconnecting.
        await again.send_json({'type': 'message', 'text': 'hello'})
        await self.delta(again, 'message')
        await again.close()
        await asyncio.sleep(0.1)
        thief = await self.client.ws_connect('/ws?client=alice&token=stolen-token-12345')
        message = await thief.receive()
        self.assertEqual((message.type, message.data), (WSMsgType.CLOSE, 4003))

    async def test_invalid_inputs(self):
        response = await self.client.get('/ws?client=bad%27id&token=' + 'x' * 20)
        self.assertEqual(response.status, 400)
        response = await self.client.get('/ws?client=other')
        self.assertEqual(response.status, 400)
        response = await self.client.get('/ws?client=other&token=' + 'x' * 20,
                                         headers={'Origin': 'https://evil.example'})
        self.assertEqual(response.status, 403)
        response = await self.client.post('/message', json={'id': 'alice', 'text': 'x'})
        self.assertEqual(response.status, 404)
        ws = await self.client.ws_connect('/ws?client=bob&token=' + 'y' * 20)
        # Chat before joining is refused.
        await ws.send_json({'type': 'message', 'text': 'test'})
        self.assertEqual((await ws.receive_json())['type'], 'error')
        await ws.send_json({'type': 'presence', 'name': 'bob'})
        self.assertEqual((await ws.receive_json())['type'], 'state')
        await ws.send_json({'type': 'message', 'text': '   '})
        await self.delta(ws, 'error')
        await ws.send_json({'type': 'presence', 'name': 'Robert'})
        state = await self.state_with(ws, lambda d: d['users'][0]['name'] == 'Robert')
        self.assertEqual(state['users'][0]['id'], 'bob')
        await ws.close()

    async def test_reactions_use_ids_and_survive_renames(self):
        alice = await self.connect('alice')
        bob = await self.connect('bob')
        await alice.send_json({'type': 'message', 'text': 'hi'})
        mid = (await self.delta(bob, 'message'))['message']['msg_id']
        # A homonym of alice must not cancel her reaction.
        await alice.send_json({'type': 'react', 'msg_id': mid, 'emoji': '👍'})
        await self.delta(bob, 'reactions')
        await bob.send_json({'type': 'presence', 'name': 'alice'})
        await bob.send_json({'type': 'react', 'msg_id': mid, 'emoji': '👍'})
        delta = await self.delta(bob, 'reactions')
        self.assertEqual(delta['reactions'], {'👍': ['alice', 'bob']})
        await alice.close()
        await bob.close()

    async def test_chat_flood_is_rate_limited(self):
        alice = await self.connect('alice')
        bob = await self.connect('bob')
        for i in range(40):
            await alice.send_json({'type': 'message', 'text': f'spam {i}'})
        warning = await self.delta(alice, 'error')
        self.assertIn('ralentissez', warning['error'])
        # Only the burst got through; the connection stays usable once tokens refill.
        await asyncio.sleep(1.2)
        await alice.send_json({'type': 'message', 'text': 'apres'})
        texts = []
        async with asyncio.timeout(3):
            while not texts or texts[-1] != 'apres':
                delta = await self.delta(bob, 'message')
                texts.append(delta['message']['text'])
        self.assertLess(len(texts), 20)
        await alice.close()
        await bob.close()

    async def test_muted_is_shared_but_only_while_in_voice(self):
        alice = await self.connect('alice', in_voice=True, muted=True)
        bob = await self.connect('bob', muted=True)  # not in voice: the flag is ignored
        state = await self.state_with(bob, lambda d: len(d['users']) == 2)
        users = {u['id']: u for u in state['users']}
        self.assertTrue(users['alice']['muted'])
        self.assertFalse(users['bob']['muted'])
        self.assertEqual(state['voice_users'], [{'id': 'alice', 'name': 'alice', 'muted': True}])
        await alice.send_json({'type': 'presence', 'name': 'alice', 'in_voice': True, 'muted': False})
        update = await self.state_with(bob, lambda d: d['voice_users'] and not d['voice_users'][0]['muted'])
        self.assertFalse(update['voice_users'][0]['muted'])
        await alice.close()
        await bob.close()

    async def test_typing_reaches_others_only_and_is_rate_limited(self):
        alice = await self.connect('alice')
        bob = await self.connect('bob')
        await alice.send_json({'type': 'typing'})
        hint = await self.delta(bob, 'typing')
        self.assertEqual((hint['id'], hint['name']), ('alice', 'alice'))
        # The sender never gets its own hint back; a burst is cut by the rate limit.
        for _ in range(20):
            await alice.send_json({'type': 'typing'})
        await alice.send_json({'type': 'message', 'text': 'fin'})
        seen = 0
        while True:
            data = await alice.receive_json()
            self.assertNotEqual(data['type'], 'typing')
            if data['type'] == 'message':
                break
        async with asyncio.timeout(3):
            while True:
                data = await bob.receive_json()
                if data['type'] == 'typing':
                    seen += 1
                if data['type'] == 'message':
                    break
        self.assertLessEqual(seen, 6)
        # Typing before joining is refused.
        ghost = await self.client.ws_connect('/ws?client=ghost&token=' + 'g' * 20)
        await ghost.send_json({'type': 'typing'})
        self.assertEqual((await ghost.receive_json())['type'], 'error')
        await ghost.close()
        await alice.close()
        await bob.close()

    async def test_joiner_gets_snapshot_then_only_deltas(self):
        alice = await self.connect('alice')
        await alice.send_json({'type': 'message', 'text': 'avant'})
        await self.delta(alice, 'message')
        bob = await self.client.ws_connect('/ws?client=bob&token=' + 'b' * 20)
        await bob.send_json({'type': 'presence', 'name': 'bob'})
        state = await bob.receive_json()
        self.assertEqual(state['type'], 'state')
        self.assertEqual([m['text'] for m in state['messages']], ['avant'])
        # Presence updates never resend the history.
        await alice.send_json({'type': 'presence', 'name': 'Alice', 'in_voice': True})
        update = await self.state_with(bob, lambda d: d['voice_users'])
        self.assertEqual(update['type'], 'users')
        self.assertNotIn('messages', update)
        await alice.close()
        await bob.close()


    async def test_config_assets_and_presence_changes(self):
        static = ('app.js', 'session.js', 'settings.js', 'emoji.js', 'util.js', 'media/index.js',
                  'media/peers.js', 'chat/messages.js', 'base.css', 'style.css', 'icon.svg')
        for route in ('/', '/config', *('/static/' + name for name in static)):
            response = await self.client.get(route)
            self.assertEqual(response.status, 200)
        alice = await self.connect('alice', in_voice=True)
        bob = await self.connect('bob')
        await alice.send_json({'type': 'presence', 'name': 'Alice', 'in_voice': False,
                               'sharing_screen': False, 'receive_screens': True})
        state = await self.state_with(bob, lambda d: not d['voice_users'])
        self.assertEqual(next(u['name'] for u in state['users'] if u['id'] == 'alice'), 'Alice')
        await alice.close()
        await bob.close()


class FakeSocket:
    def __init__(self, stuck=False):
        self.stuck, self.sent, self.closed, self.close_code = stuck, [], False, None

    async def send_str(self, text):
        if self.stuck:
            await asyncio.sleep(3600)
        self.sent.append(text)

    async def close(self, code=1000, message=b''):
        self.closed, self.close_code = True, code


class SlowPeerTests(unittest.IsolatedAsyncioTestCase):
    async def test_stuck_peer_is_dropped_and_does_not_delay_others(self):
        room = Room()
        stuck, healthy = FakeSocket(stuck=True), FakeSocket()
        room.sockets['stuck'] = Client(stuck, max_queue=3)
        room.sockets['ok'] = Client(healthy, max_queue=3)
        for i in range(10):
            room.broadcast({'type': 'message', 'n': i})
            await asyncio.sleep(0)
        await asyncio.sleep(0.05)
        self.assertEqual(len(healthy.sent), 10)
        self.assertTrue(stuck.closed)
        self.assertEqual(stuck.close_code, 1013)
        for client in room.sockets.values():
            client.stop()

    async def test_order_is_preserved_per_peer(self):
        room = Room()
        fake = FakeSocket()
        room.sockets['a'] = Client(fake)
        for i in range(50):
            room.broadcast({'n': i})
        await asyncio.sleep(0.05)
        self.assertEqual([json.loads(s)['n'] for s in fake.sent], list(range(50)))
        room.sockets['a'].stop()


PNG = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
       b'\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82')


class ImageTests(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    async def join(self, cid):
        token = cid.ljust(16, 'x')
        ws = await self.client.ws_connect(f'/ws?client={cid}&token={token}')
        await ws.send_json({'type': 'presence', 'name': cid})
        await ws.receive_json()
        return ws, {'X-Client-Id': cid, 'X-Token': token}

    async def upload(self, headers, body=PNG):
        return await self.client.post('/upload', data=io.BytesIO(body), headers=headers)

    async def test_upload_message_and_download(self):
        alice, alice_headers = await self.join('alice')
        bob, _ = await self.join('bob')
        response = await self.upload(alice_headers)
        self.assertEqual(response.status, 200)
        image_id = (await response.json())['id']
        await alice.send_json({'type': 'message', 'text': 'voici', 'image': {'id': image_id, 'w': 1, 'h': 1}})
        while True:
            data = await bob.receive_json()
            if data['type'] == 'message':
                break
        self.assertEqual(data['message']['image'], {'id': image_id, 'w': 1, 'h': 1})
        image = await self.client.get(f'/img/{image_id}')
        self.assertEqual((image.status, image.content_type), (200, 'image/png'))
        self.assertEqual(await image.read(), PNG)
        self.assertEqual(image.headers['X-Content-Type-Options'], 'nosniff')
        self.assertIn("default-src 'none'", image.headers['Content-Security-Policy'])
        # An image can be attached to one message only, and only by whoever uploaded it.
        await alice.send_json({'type': 'message', 'text': 'encore', 'image': {'id': image_id}})
        while (data := await alice.receive_json())['type'] != 'error':
            pass
        self.assertIn('introuvable', data['error'])
        await alice.close()
        await bob.close()

    async def test_upload_is_authenticated_and_validated(self):
        alice, headers = await self.join('alice')
        self.assertEqual((await self.client.post('/upload', data=PNG)).status, 403)
        wrong = {**headers, 'X-Token': 'z' * 16}
        self.assertEqual((await self.upload(wrong)).status, 403)
        self.assertEqual((await self.upload(headers, b'<svg onload=alert(1)></svg>')).status, 415)
        self.assertEqual((await self.upload(headers, b'')).status, 415)
        too_big = PNG + b'\x00' * (3 * 1024 * 1024)
        self.assertEqual((await self.upload(headers, too_big)).status, 413)
        self.assertEqual((await self.client.get('/img/' + '0' * 32)).status, 404)
        # Somebody else cannot claim alice's upload.
        bob, _ = await self.join('bob')
        image_id = (await (await self.upload(headers)).json())['id']
        await bob.send_json({'type': 'message', 'text': 'vol', 'image': {'id': image_id}})
        while (await bob.receive_json())['type'] != 'error':
            pass
        await alice.close()
        await bob.close()

    async def test_upload_rate_limit(self):
        alice, headers = await self.join('alice')
        statuses = [(await self.upload(headers)).status for _ in range(8)]
        self.assertEqual(statuses[:5], [200] * 5)
        self.assertIn(429, statuses)
        await alice.close()


class ImageStoreTests(unittest.TestCase):
    def test_oldest_images_are_evicted_over_the_memory_limit(self):
        store = ImageStore(limit=100)
        first = store.add('a', b'x' * 60, 'image/png')
        second = store.add('a', b'x' * 60, 'image/png')
        self.assertIsNone(store.get(first))
        self.assertIsNotNone(store.get(second))
        self.assertLessEqual(store.total, 100)

    def test_images_leave_with_their_messages_and_stale_uploads_expire(self):
        room = Room()
        image_id = room.images.add('a', b'img', 'image/png')
        room.images.claim(image_id, 'a')
        room.add_message({'msg_id': 'm0', 'image': {'id': image_id}})
        for index in range(200):
            room.add_message({'msg_id': f'm{index + 1}'})
        self.assertIsNone(room.images.get(image_id))
        pending = room.images.add('a', b'img', 'image/png')
        room.images.items[pending]['time'] -= 10_000
        room.images.add('a', b'other', 'image/png')
        self.assertIsNone(room.images.get(pending))


class PasswordTests(AioHTTPTestCase):
    async def get_application(self):
        os.environ['LAN_CHAT_PASSWORD'] = 'sesame'
        self.addCleanup(os.environ.pop, 'LAN_CHAT_PASSWORD', None)
        return create_app()

    async def test_password_gates_websocket_and_ice_config(self):
        public = await (await self.client.get('/config')).json()
        self.assertTrue(public['passwordRequired'])
        self.assertNotIn('iceServers', public)
        full = await (await self.client.get('/config', headers={'X-Room-Password': 'sesame'})).json()
        self.assertIn('iceServers', full)
        for suffix in ('', '&password=wrong'):
            ws = await self.client.ws_connect('/ws?client=alice&token=' + 'a' * 20 + suffix)
            message = await ws.receive()
            self.assertEqual((message.type, message.data), (WSMsgType.CLOSE, 4004))
        ws = await self.client.ws_connect('/ws?client=alice&token=' + 'a' * 20 + '&password=sesame')
        await ws.send_json({'type': 'presence', 'name': 'alice'})
        self.assertEqual((await ws.receive_json())['type'], 'state')
        await ws.close()


class OpenRoomTests(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    async def test_no_password_by_default(self):
        public = await (await self.client.get('/config')).json()
        self.assertFalse(public['passwordRequired'])
        self.assertIn('iceServers', public)


if __name__ == '__main__':
    unittest.main()

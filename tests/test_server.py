import asyncio
import unittest
from aiohttp.test_utils import AioHTTPTestCase
from aiohttp import WSMsgType
from server import create_app


class SignalingTests(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    async def connect(self, cid, token=None, **presence):
        ws = await self.client.ws_connect(f'/ws?client={cid}&token={token or cid.ljust(16, "x")}')
        await ws.send_json({'type': 'presence', 'name': cid, **presence})
        await self.state_with(ws, lambda d: any(u['id'] == cid for u in d['users']))
        return ws

    async def state_with(self, ws, predicate):
        async with asyncio.timeout(3):
            while True:
                data = await ws.receive_json()
                if data.get('type') == 'state' and predicate(data):
                    return data

    async def test_join_signal_message_reaction_and_disconnect(self):
        alice = await self.connect('alice', sharing_screen=True)
        bob = await self.connect('bob', receive_screens=False)
        state = await self.state_with(alice, lambda d: len(d['users']) == 2)
        self.assertEqual(state['screen_users'], [{'id': 'alice', 'name': 'alice'}])
        self.assertFalse(next(u for u in state['users'] if u['id'] == 'bob')['receive_screens'])
        await alice.send_json({'type': 'signal', 'from': 'forged', 'target': 'bob',
                               'signal': {'candidate': {'candidate': 'test'}}})
        signal = await bob.receive_json(timeout=3)
        self.assertEqual(signal['from'], 'alice')
        self.assertEqual(signal['type'], 'signal')
        await alice.send_json({'type': 'message', 'id': 'bob', 'name': 'forged', 'text': 'Bonjour'})
        state = await self.state_with(bob, lambda d: len(d['messages']) == 1)
        self.assertEqual(state['messages'][0]['name'], 'alice')
        mid = state['messages'][0]['msg_id']
        for expected in ({'👍': ['bob']}, {}):
            await bob.send_json({'type': 'react', 'msg_id': mid, 'emoji': '👍'})
            state = await self.state_with(bob, lambda d: d['messages'][0]['reactions'] == expected)
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
        message = await alice.receive()
        self.assertEqual((message.type, message.data), (WSMsgType.CLOSE, 4001))
        await again.send_json({'type': 'presence', 'name': 'alice'})
        await self.state_with(again, lambda d: len(d['users']) == 1)
        # The identity stays protected while it owns messages after disconnecting.
        await again.send_json({'type': 'message', 'text': 'hello'})
        await self.state_with(again, lambda d: len(d['messages']) == 1)
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
        await ws.receive_json()
        await ws.send_json({'type': 'message', 'text': '   '})
        self.assertEqual((await ws.receive_json())['type'], 'error')
        await ws.send_json({'type': 'update_profile', 'name': 'Robert'})
        state = await self.state_with(ws, lambda d: d['users'][0]['name'] == 'Robert')
        self.assertEqual(state['users'][0]['id'], 'bob')
        await ws.close()

    async def test_config_assets_and_presence_changes(self):
        for route in ('/', '/media.js', '/config'):
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


if __name__ == '__main__':
    unittest.main()

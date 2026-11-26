import asyncio
import unittest
from aiohttp.test_utils import AioHTTPTestCase
from aiohttp import WSMsgType
from server import create_app


class SignalingTests(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    async def connect(self, cid, **presence):
        ws = await self.client.ws_connect('/ws?client=' + cid)
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
        response = await self.client.post('/message', json={'id': 'alice', 'name': 'forged', 'text': 'Bonjour'})
        self.assertEqual(response.status, 200)
        state = await self.state_with(bob, lambda d: len(d['messages']) == 1)
        self.assertEqual(state['messages'][0]['name'], 'alice')
        mid = state['messages'][0]['msg_id']
        for expected in ({'👍': ['bob']}, {}):
            response = await self.client.post('/react', json={'id': 'bob', 'msg_id': mid, 'emoji': '👍'})
            self.assertEqual(response.status, 200)
            state = await self.state_with(bob, lambda d: d['messages'][0]['reactions'] == expected)
        await alice.close()
        state = await self.state_with(bob, lambda d: len(d['users']) == 1)
        self.assertEqual(state['screen_users'], [])
        await bob.close()

    async def test_duplicate_invalid_identity_and_cross_origin(self):
        alice = await self.connect('alice')
        duplicate = await self.client.ws_connect('/ws?client=alice')
        message = await duplicate.receive()
        self.assertEqual(message.type, WSMsgType.CLOSE)
        self.assertEqual(message.data, 4001)
        response = await self.client.get('/ws?client=bad%27id')
        self.assertEqual(response.status, 400)
        response = await self.client.get('/ws?client=other', headers={'Origin': 'https://evil.example'})
        self.assertEqual(response.status, 403)
        response = await self.client.post('/message', json={'id': 'absent', 'text': 'test'})
        self.assertEqual(response.status, 403)
        response = await self.client.post('/message', json=[])
        self.assertEqual(response.status, 400)
        await alice.close()

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

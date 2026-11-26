import asyncio
import os
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
        for route in ('/', '/static/app.js', '/static/media.js', '/static/session.js', '/static/style.css', '/config'):
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

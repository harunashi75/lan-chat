"""Handlers for the messages a connected client can send: presence, signals, chat and reactions."""
import time
import uuid


def valid_token(value):
    return 16 <= len(value) <= 100 and all(c.isalnum() or c in '-_' for c in value)


def clean_name(value, fallback):
    return str(value or '').strip()[:40] or fallback


def handle_presence(room, client, cid, data, first):
    user = {'id': cid, 'name': clean_name(data.get('name'), 'Utilisateur'),
            'pc': 'Navigateur', 'in_voice': data.get('in_voice') is True,
            'sharing_screen': data.get('sharing_screen') is True,
            'receive_screens': data.get('receive_screens', True) is True}
    changed = room.users.get(cid) != user
    if changed:
        room.users[cid] = user
    if first:
        client.send(room.snapshot())
    if changed:
        room.broadcast()


def handle_signal(room, client, cid, data):
    target = room.sockets.get(data.get('target'))
    signal = data.get('signal')
    if target is not None and target is not client and isinstance(signal, dict):
        target.send({'type': 'signal', 'from': cid, 'signal': signal})


def attach_image(room, cid, image):
    """Validate the image reference of a message and claim the upload. Returns the public metadata."""
    if not image:
        return None
    if not isinstance(image, dict) or not isinstance(image.get('id'), str):
        raise ValueError('Image invalide')
    if not room.images.claim(image['id'], cid):
        raise ValueError('Image introuvable ou déjà utilisée')

    def dimension(value):  # only used to reserve space in the layout; clamp whatever the client says
        return value if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 10000 else None
    return {'id': image['id'], 'w': dimension(image.get('w')), 'h': dimension(image.get('h'))}


def handle_typing(room, cid):
    """Tell the others that this user is typing. Not stored: it is only a live hint."""
    room.broadcast({'type': 'typing', 'id': cid, 'name': room.users[cid]['name']}, exclude=cid)


def handle_chat(room, cid, data):
    """Chat actions; the sender is always the authenticated socket's identity."""
    user = room.users[cid]
    kind = data['type']
    if kind == 'message':
        text = str(data.get('text', '')).strip()[:2000]
        image = attach_image(room, cid, data.get('image'))
        if not text and not image:
            raise ValueError('Message vide')
        message = {'msg_id': 'msg_' + uuid.uuid4().hex, 'id': cid, 'name': user['name'], 'pc': user['pc'],
                   'text': text, 'time': time.time(), 'reactions': {}}
        if image:
            message['image'] = image
        room.add_message(message)
        room.broadcast({'type': 'message', 'message': message})
        return
    elif kind == 'react':
        emoji = str(data.get('emoji', '')).strip()[:64]
        if not emoji:
            raise ValueError('Emoji vide')
        for msg in room.messages:
            if msg['msg_id'] == data.get('msg_id'):
                names = msg['reactions'].setdefault(emoji, [])
                # Reactions are stored by client id so homonyms and renames stay correct.
                if cid in names:
                    names.remove(cid)
                else:
                    names.append(cid)
                if not names:
                    del msg['reactions'][emoji]
                room.broadcast({'type': 'reactions', 'msg_id': msg['msg_id'], 'reactions': msg['reactions']})
                break
        return

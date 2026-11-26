// Who is speaking right now: a tiny shared store between the media code (which detects
// voice activity) and the chat UI (which draws the ring around avatars).
const speaking = new Set();
const listeners = new Set();

export const isSpeaking = id => speaking.has(id);

export function setSpeaking(id, value) {
  if (value === speaking.has(id)) return;
  if (value) speaking.add(id);
  else speaking.delete(id);
  listeners.forEach(listener => listener(id, value));
}

export function onSpeakingChange(listener) {
  listeners.add(listener);
}

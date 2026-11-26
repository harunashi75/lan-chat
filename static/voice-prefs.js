// Your own listening preferences for each person in the voice channel (volume, local mute).
// They only affect what *you* hear. Shared between the chat UI (controls) and media/ (playback).
// Kept for the lifetime of the page: client ids are per browser session.
const volumes = new Map(); // client id -> 0..2 (1 = normal, up to 200%)
const muted = new Set();
const listeners = new Set();

export const getVolume = id => volumes.get(id) ?? 1;
export const isMuted = id => muted.has(id);

export function setVolume(id, value) {
  volumes.set(id, Math.min(2, Math.max(0, value)));
  listeners.forEach(listener => listener(id));
}

export function setMuted(id, value) {
  if (value) muted.add(id);
  else muted.delete(id);
  listeners.forEach(listener => listener(id));
}

export function onVoicePrefChange(listener) {
  listeners.add(listener);
}

// Playback of other people's microphones: per-person volume and local mute.
import { audioContext } from '../sounds.js';
import { getVolume, isMuted, onVoicePrefChange } from '../voice-prefs.js';

// <audio>.volume stops at 100%, so above that the stream is played through a gain node instead.
function createBoost(audio) {
  try {
    const ctx = audioContext();
    const source = ctx.createMediaStreamSource(audio.srcObject);
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    audio._boost = { source, gain };
    return audio._boost;
  } catch (error) {
    console.warn('Volume boost unavailable', error);
    return null;
  }
}

export function releaseAudio(audio) {
  if (!audio._boost) return;
  audio._boost.source.disconnect();
  audio._boost.gain.disconnect();
  delete audio._boost;
}

// Applies the room rules (data-room-muted, set by updateRemoteAudio) and the user's own settings.
export function applyPlayback(audio) {
  const cid = audio.dataset.peer;
  const silent = audio.dataset.roomMuted === '1' || isMuted(cid);
  const volume = getVolume(cid);
  if (volume <= 1) {
    releaseAudio(audio);
    audio.muted = silent;
    audio.volume = volume;
    return;
  }
  const boost = audio._boost || createBoost(audio);
  if (!boost) { // no Web Audio: settle for the maximum the element allows
    audio.muted = silent;
    audio.volume = 1;
    return;
  }
  audio.muted = true; // the element stays silent: the gain node does the playing
  boost.gain.gain.value = silent ? 0 : volume;
}

export function initVolume() {
  onVoicePrefChange(cid => {
    document.querySelectorAll(`#audioContainer audio[data-peer="${CSS.escape(cid)}"][data-kind="microphone"]`)
      .forEach(applyPlayback);
  });
}

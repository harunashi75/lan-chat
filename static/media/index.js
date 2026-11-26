// Voice and screen sharing over WebRTC (mesh). Signaling goes through session.js.
import { $ } from '../util.js';
import { on, close, updatePresence } from '../session.js';
import { media, peerConnections, remoteScreenStreams } from './state.js';
import { VIDEO_PROFILES, changeVideoProfile } from './profiles.js';
import { initTiles } from './tiles.js';
import { initPeers, closeAllPeers, handleWebRTCSignals, applyState, syncPresence } from './peers.js';
import { toggleVoiceChannel, toggleScreenShare } from './capture.js';
import { initDiagnostics } from './diagnostics.js';

// Read-only access to live objects, used by the end-to-end browser test.
export function mediaDebug() {
  return { peerConnections, remoteScreenStreams, screenVideoTrack: media.screenVideoTrack };
}

function cleanup() {
  Object.values(peerConnections).forEach(pc => pc.close());
  media.screenStream?.getTracks().forEach(track => track.stop());
  media.localStream?.getTracks().forEach(track => track.stop());
}

export function initMedia() {
  on('signal', data => handleWebRTCSignals([data]));
  on('state', applyState);
  on('users', applyState);
  on('disconnect', closeAllPeers);

  $('voiceToggleBtn').addEventListener('click', toggleVoiceChannel);
  $('screenShareBtn').addEventListener('click', toggleScreenShare);
  $('videoProfile').addEventListener('change', changeVideoProfile);
  $('receiveScreens').addEventListener('change', syncPresence);

  const savedProfile = localStorage.getItem('lan_video_profile');
  if (VIDEO_PROFILES[savedProfile]) $('videoProfile').value = savedProfile;

  initTiles();
  initPeers();
  initDiagnostics();
  updatePresence({ receive_screens: $('receiveScreens').checked });
  window.addEventListener('beforeunload', () => { close(); cleanup(); });
}

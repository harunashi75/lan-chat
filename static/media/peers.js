// One RTCPeerConnection per participant (mesh): negotiation, tracks, remote audio, room state.
import { $, showToast } from '../util.js';
import { send, updatePresence, isReady, getClientId, getRtcConfig } from '../session.js';
import { media, peerConnections, peerState, previousStats } from './state.js';
import { addOrUpdateScreenTile, removeScreenTile } from './tiles.js';
import { configureVideoSender } from './profiles.js';

export function closePeer(cid) {
  const pc = peerConnections[cid];
  if (pc) { pc.onnegotiationneeded = null; pc.onconnectionstatechange = null; pc.onicecandidate = null; pc.ontrack = null; pc.close(); }
  delete peerConnections[cid];
  delete peerState[cid];
  previousStats.delete(cid);
  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    if (audio.dataset.peer === cid) audio.remove();
  });
  removeScreenTile(cid);
}

export async function syncPeerTracks(cid, pc) {
  const target = media.users.find(u => u.id === cid);
  const desired = [
    ...(media.inVoice && target?.in_voice && media.localStream ? media.localStream.getAudioTracks() : []),
    ...(target?.receive_screens && media.screenStream ? media.screenStream.getTracks() : [])
  ];
  for (const sender of pc.getSenders()) {
    if (sender.track && !desired.includes(sender.track)) pc.removeTrack(sender);
  }
  for (const track of desired) {
    if (!pc.getSenders().some(sender => sender.track === track)) {
      const stream = media.screenStream?.getTracks().includes(track) ? media.screenStream : media.localStream;
      const sender = pc.addTrack(track, stream);
      await configureVideoSender(sender);
    }
  }
}

export async function renegotiatePeer(targetCid, pc) {
  const state = peerState[targetCid];
  if (!state || state.makingOffer || pc.signalingState !== 'stable' || !isReady()) return;
  try {
    state.makingOffer = true;
    await pc.setLocalDescription();
    await sendSignal(targetCid, { sdp:pc.localDescription });
  } catch (error) { console.error('Négociation', error); }
  finally { state.makingOffer = false; }
}

export async function handleWebRTCSignals(signals) {
  for (const {from:cid, signal} of signals) {
    if (!media.users.some(u => u.id === cid)) continue;
    const pc = peerConnections[cid] || createPeerConnection(cid);
    const state = peerState[cid];
    try {
      if (signal.sdp) {
        const description = signal.sdp;
        const ready = !state.makingOffer && (pc.signalingState === 'stable' || state.settingAnswer);
        const collision = description.type === 'offer' && !ready;
        state.ignoreOffer = !state.polite && collision;
        if (state.ignoreOffer) continue;
        state.remoteMedia = signal.media || {};
        state.settingAnswer = description.type === 'answer';
        try { await pc.setRemoteDescription(description); }
        finally { state.settingAnswer = false; }
        for (const candidate of state.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (description.type === 'offer') {
          await syncPeerTracks(cid, pc);
          await pc.setLocalDescription();
          await sendSignal(cid, {sdp:pc.localDescription});
        }
        for (const sender of pc.getSenders()) await configureVideoSender(sender);
      } else if (signal.candidate && !state.ignoreOffer) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else state.candidates.push(signal.candidate);
      }
    } catch (error) { console.error('Signal WebRTC', cid, error); }
  }
}

export function createPeerConnection(cid) {
  const pc = new RTCPeerConnection(getRtcConfig());
  peerConnections[cid] = pc;
  peerState[cid] = { polite:getClientId() > cid, makingOffer:false, settingAnswer:false, ignoreOffer:false, candidates:[] };
  pc.onnegotiationneeded = () => renegotiatePeer(cid, pc);
  pc.onicecandidate = ({candidate}) => {
    if (candidate) sendSignal(cid, {candidate}).catch(console.error);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce();
  };
  pc.ontrack = ({track, streams}) => {
    const stream = streams[0] || new MediaStream([track]);
    if (track.kind === 'video') {
      addOrUpdateScreenTile(cid, stream, `${media.usersById[cid]?.name || 'Participant'} partage son écran`, false);
      track.onended = () => removeScreenTile(cid);
    } else {
      // Each audio track gets its own dedicated output element (videos stay muted).
      let audio = document.getElementById(`audio-${cid}-${track.id}`);
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${cid}-${track.id}`;
        audio.dataset.peer = cid;
        audio.dataset.stream = stream.id;
        audio.autoplay = true;
        $('audioContainer').appendChild(audio);
      }
      audio.dataset.kind = peerState[cid]?.remoteMedia?.microphone === stream.id ? 'microphone' : 'screen';
      audio.srcObject = new MediaStream([track]);
      stream.addEventListener('removetrack', event => { if (event.track === track) audio.remove(); });
      updateRemoteAudio(cid);
      audio.play().catch(() => showToast('Cliquez dans le salon pour autoriser le son'));
      track.onended = () => audio.remove();
    }
  };
  return pc;
}

export async function sendSignal(target, signal) {
  if (signal.sdp) signal.media = {microphone:media.localStream?.id, screen:media.screenStream?.id};
  if (!send({type:'signal',target,signal})) throw new Error('Signalisation déconnectée');
}

export function updateRemoteAudio(cid) {
  const user = media.usersById[cid];
  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    if (audio.dataset.peer !== cid) return;
    audio.muted = audio.dataset.kind === 'microphone'
      ? !(media.inVoice && user?.in_voice)
      : !($('receiveScreens').checked && user?.sharing_screen);
  });
}

export function syncPresence() {
  Object.keys(peerConnections).forEach(updateRemoteAudio);
  updatePresence({ in_voice:media.inVoice, sharing_screen:!!media.screenStream, receive_screens:$('receiveScreens').checked });
}

export async function applyState(data) {
  media.users = data.users || [];
  media.usersById = Object.fromEntries(media.users.map(u => [u.id,u]));
  const needed = new Set();
  for (const user of media.users) {
    if (user.id === getClientId()) continue;
    if ((media.inVoice && user.in_voice) || (media.screenStream && user.receive_screens) || (user.sharing_screen && $('receiveScreens').checked)) {
      needed.add(user.id);
      const pc = peerConnections[user.id] || createPeerConnection(user.id);
      await syncPeerTracks(user.id,pc);
      await Promise.all(pc.getSenders().map(configureVideoSender));
    }
    updateRemoteAudio(user.id);
    if (!user.sharing_screen || !$('receiveScreens').checked) removeScreenTile(user.id);
  }
  for (const cid of Object.keys(peerConnections)) if (!needed.has(cid)) closePeer(cid);
  // Also drop outputs of streams that went inactive without a remote 'ended' event.
  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    const user = media.usersById[audio.dataset.peer];
    if (!user || (!user.in_voice && !user.sharing_screen)) audio.remove();
  });
}

export function closeAllPeers() {
  Object.keys(peerConnections).forEach(closePeer);
}

// Browsers block audio until the user interacts with the page: retry on the next click.
export function initPeers() {
  document.addEventListener('click', () => {
    document.querySelectorAll('#audioContainer audio').forEach(audio => {
      if (!audio.muted && audio.paused) audio.play().catch(() => {});
    });
  });
}

// Local capture: microphone (voice channel) and screen sharing.
import { $, showToast } from '../util.js';
import { isReady, getClientId, getName } from '../session.js';
import { media, peerConnections } from './state.js';
import { addOrUpdateScreenTile, removeScreenTile } from './tiles.js';
import { selectedProfile } from './profiles.js';
import { syncPresence } from './peers.js';
import { watchStream, unwatch } from './activity.js';
import { applyPlayback } from './volume.js';
import { playVoiceCue } from '../sounds.js';

export async function toggleVoiceChannel() {
  if (!isReady()) { showToast("Attendez la connexion au salon"); return; }
  if (!media.inVoice) {
    try {
      media.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      media.inVoice = true;
      media.muted = false;
      watchStream(getClientId(), media.localStream);
      $("muteBtn").hidden = false;
      renderMuteButton();
      $("voiceToggleBtn").classList.add("active");
      $("voiceBtnText").textContent = "Quitter le vocal";
      showToast("Connecté au canal vocal 🎙️");

    } catch (err) {
      console.error("Erreur microphone :", err);
      showToast("Impossible d'accéder au microphone (" + err.name + ")");
      return;
    }
  } else {
    await leaveVoice();
  }
  syncPresence();
}

// Cut or restore our microphone. The track stays open but sends silence, so others see us muted at once.
export function toggleMute() {
  if (!media.inVoice || !media.localStream) return;
  media.muted = !media.muted;
  media.localStream.getAudioTracks().forEach(track => { track.enabled = !media.muted; });
  renderMuteButton();
  playVoiceCue(media.muted ? "mute" : "unmute");
  syncPresence();
}

function renderMuteButton() {
  const button = $("muteBtn");
  button.classList.toggle("active", media.muted);
  button.setAttribute("aria-pressed", String(media.muted));
  $("muteBtnText").textContent = media.muted ? "Micro coupé · réactiver" : "Couper mon micro";
  $("muteBtnIcon").textContent = media.muted ? "🔇" : "🎙️";
}

export async function leaveVoice() {
  media.inVoice = false;
  media.muted = false;
  $("muteBtn").hidden = true;
  unwatch(getClientId());

  if (media.localStream) {
    media.localStream.getTracks().forEach(track => track.stop());
    media.localStream = null;
  }

  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    if (audio.dataset.kind !== "microphone") return;
    audio.dataset.roomMuted = "1";
    applyPlayback(audio);
  });
  $("voiceToggleBtn").classList.remove("active");
  $("voiceBtnText").textContent = "Rejoindre le vocal";
  showToast("Déconnecté du vocal");
  syncPresence();
}

export async function toggleScreenShare() {
  if (media.screenStream) {
    await stopScreenShare();
    return;
  }

  if (media.screenStarting) return;
  if (!isReady()) { showToast('Attendez la connexion au salon'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('Le partage nécessite HTTPS ou localhost et un navigateur compatible'); return;
  }
  media.screenStarting = true;
  try {
    const p = selectedProfile();
    media.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width:{ideal:p.width,max:p.width}, height:{ideal:p.height,max:p.height}, frameRate:{ideal:p.fps,max:p.fps} },
      audio: $('shareAudio').checked,
      systemAudio: 'include'
    });

    media.screenVideoTrack = media.screenStream.getVideoTracks()[0] || null;
    if (!media.screenVideoTrack) throw new Error("Aucune piste vidéo reçue");
    media.screenVideoTrack.contentHint = selectedProfile().hint;
    $('shareAudio').disabled = true;
    if ($('shareAudio').checked && !media.screenStream.getAudioTracks().length) showToast('Le son système est indisponible pour cette source');

    $("screenShareBtn").classList.add("active");
    $("screenShareBtnText").textContent = "Arrêter le partage";

    addOrUpdateScreenTile(getClientId(), media.screenStream, `${getName()} · Vous`, true);
    media.screenVideoTrack.onended = () => stopScreenShare();

    // Announce right away that we are sharing.
    syncPresence();
    showToast("Partage d'écran démarré 🖥️");
  } catch (err) {
    console.error("Erreur partage d'écran :", err);
    if (media.screenStream) await stopScreenShare();
    media.screenStream = null;
    media.screenVideoTrack = null;
    if (err.name !== "NotAllowedError") showToast("Impossible de partager l'écran");
  } finally { media.screenStarting = false; }
}

export async function stopScreenShare() {
  if (!media.screenStream && !media.screenVideoTrack) return;

  const oldTracks = media.screenStream ? media.screenStream.getTracks() : [];
  media.screenVideoTrack = null;

  if (media.screenStream) {
    media.screenStream.getTracks().forEach(t => {
      t.onended = null;
      t.stop();
    });
    media.screenStream = null;
  }

  $("screenShareBtn").classList.remove("active");
  $("screenShareBtnText").textContent = "Partager l'écran";
  removeScreenTile(getClientId());

  $('shareAudio').disabled = false;
  for (const pc of Object.values(peerConnections)) {
    for (const sender of pc.getSenders()) {
      if (oldTracks.includes(sender.track)) pc.removeTrack(sender);
    }
  }

  syncPresence();
  showToast("Partage d'écran arrêté");
}

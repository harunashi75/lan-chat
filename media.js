// --- 2. WEBRTC (VOCAL) VARIABLES ---
let inVoice = false;
let localStream = null;
let peerConnections = {}; // { targetClientId: RTCPeerConnection }
let screenStream = null;
let screenVideoTrack = null;
let remoteScreenStreams = {}; // { clientId: MediaStream }
let latestUsersById = {};      // noms affichés pour les partages
let expandedScreenId = null;
let rtcConfig = { iceServers: [] };
const VIDEO_PROFILES = {
  text: { width:1920, height:1080, fps:20, bitrate:6000000, hint:'text', degradation:'maintain-resolution' },
  balanced: { width:1920, height:1080, fps:30, bitrate:10000000, hint:'detail', degradation:'balanced' },
  motion: { width:1920, height:1080, fps:60, bitrate:16000000, hint:'motion', degradation:'maintain-framerate' },
  detail: { width:2560, height:1440, fps:30, bitrate:16000000, hint:'detail', degradation:'maintain-resolution' }
};
let signalSocket = null;
let reconnectTimer = null;
let reconnectDelay = 500;
let transportReady = false;
let peerState = {};
let latestUsers = [];
let previousStats = new Map();
let diagnosticsRunning = false;
let screenStarting = false;
const selectedProfile = () => VIDEO_PROFILES[$('videoProfile').value];

function updatePresence() {
  if (signalSocket?.readyState === WebSocket.OPEN) {
    signalSocket.send(JSON.stringify({ type:'presence', name:username, in_voice:inVoice,
      sharing_screen:!!screenStream, receive_screens:$('receiveScreens').checked }));
  }
}

async function connectSignaling() {
  try {
    const response = await fetch('/config', { headers: { 'X-Room-Password': roomPassword } });
    if (!response.ok) throw new Error('Configuration indisponible');
    const config = await response.json();
    rtcConfig = { iceServers: config.iceServers || [] };
    window.lanVideoBudget = config.videoBudget || 40000000;
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('client', clientId);
    url.searchParams.set('token', sessionToken);
    if (roomPassword) url.searchParams.set('password', roomPassword);
    const ws = new WebSocket(url);
    signalSocket = ws;
    let incoming = Promise.resolve();
    ws.onopen = () => {
      reconnectDelay = 500;
      transportReady = true;
      updatePresence();
    };
    ws.onmessage = event => {
      incoming = incoming.then(async () => {
        const data = JSON.parse(event.data);
        if (data.type === 'signal') await handleWebRTCSignals([data]);
        else if (data.type === 'state' || data.type === 'users') await applyState(data);
        else if (data.type === 'message') addMessage(data.message);
        else if (data.type === 'reactions') applyReactions(data.msg_id, data.reactions, true);
        else if (data.type === 'error') showToast(data.error);
      }).catch(err => console.error('Signalisation', err));
    };
    ws.onclose = event => {
      if (event.code === 4004 && signalSocket === ws) {
        signalSocket = null;
        transportReady = false;
        connectionEl.textContent = 'Mot de passe requis';
        requirePassword();
        return;
      }
      if ((event.code === 4001 || event.code === 4003) && signalSocket === ws) {
        // Identity taken over by another tab, or token rejected: start a fresh identity.
        clientId = crypto.randomUUID();
        sessionToken = crypto.randomUUID();
        sessionStorage.setItem('lan_chat_client_id',clientId);
        sessionStorage.setItem('lan_chat_token',sessionToken);
      }
      if (signalSocket !== ws) return;
      transportReady = false;
      connectionEl.textContent = 'Reconnexion…';
      Object.keys(peerConnections).forEach(closePeer);
      reconnectTimer = setTimeout(connectSignaling, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    };
    ws.onerror = () => ws.close();
  } catch (err) {
    console.error(err);
    connectionEl.textContent = 'Serveur indisponible · reconnexion…';
    reconnectTimer = setTimeout(connectSignaling, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  }
}

async function configureVideoSender(sender) {
  if (sender.track?.kind !== 'video') return;
  const profile = selectedProfile();
  const params = sender.getParameters();
  if (!params.encodings?.length) return;
  const viewers = Math.max(1, latestUsers.filter(u => u.id !== clientId && u.receive_screens).length);
  // Budget global configurable, partagé entre les spectateurs en mode pair à pair.
  const totalBudget = Number(window.lanVideoBudget || 40000000);
  params.encodings.forEach(encoding => {
    encoding.maxBitrate = Math.min(profile.bitrate, Math.floor(totalBudget / viewers));
    encoding.maxFramerate = profile.fps;
  });
  params.degradationPreference = profile.degradation;
  try { await sender.setParameters(params); }
  catch (error) { console.warn('Réglages encodeur non appliqués', error); }
}

async function changeVideoProfile() {
  localStorage.setItem('lan_video_profile', $('videoProfile').value);
  if (!screenVideoTrack) return;
  const p = selectedProfile();
  screenVideoTrack.contentHint = p.hint;
  try {
    await screenVideoTrack.applyConstraints({width:{ideal:p.width,max:p.width},height:{ideal:p.height,max:p.height},frameRate:{ideal:p.fps,max:p.fps}});
    await Promise.all(Object.values(peerConnections).flatMap(pc => pc.getSenders().map(configureVideoSender)));
  } catch (error) { console.error(error); showToast('Ce profil ne peut pas être appliqué sur cette source'); }
}
const savedVideoProfile = localStorage.getItem('lan_video_profile');
if (VIDEO_PROFILES[savedVideoProfile]) $('videoProfile').value = savedVideoProfile;

function closePeer(cid) {
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

async function syncPeerTracks(cid, pc) {
  const target = latestUsers.find(u => u.id === cid);
  const desired = [
    ...(inVoice && target?.in_voice && localStream ? localStream.getAudioTracks() : []),
    ...(target?.receive_screens && screenStream ? screenStream.getTracks() : [])
  ];
  for (const sender of pc.getSenders()) {
    if (sender.track && !desired.includes(sender.track)) pc.removeTrack(sender);
  }
  for (const track of desired) {
    if (!pc.getSenders().some(sender => sender.track === track)) {
      const stream = screenStream?.getTracks().includes(track) ? screenStream : localStream;
      const sender = pc.addTrack(track, stream);
      await configureVideoSender(sender);
    }
  }
}

async function collectDiagnostics() {
  if (diagnosticsRunning) return;
  diagnosticsRunning = true;
  const lines = [];
  const measurements = [];
  try {
    for (const [cid, pc] of Object.entries(peerConnections)) {
      const stats = await pc.getStats();
      const previous = previousStats.get(cid) || new Map();
      const next = new Map();
      const name = latestUsersById[cid]?.name || 'Participant';
      for (const report of stats.values()) {
        if (!['inbound-rtp','outbound-rtp'].includes(report.type) || (report.kind || report.mediaType) !== 'video') continue;
        const outgoing = report.type === 'outbound-rtp';
        const transceiver = pc.getTransceivers().find(t => t.mid === report.mid);
        if (transceiver) {
          const direction = transceiver.currentDirection;
          if (outgoing && (!transceiver.sender.track || !['sendonly','sendrecv'].includes(direction))) continue;
          if (!outgoing && !['recvonly','sendrecv'].includes(direction)) continue;
        }
        const bytes = outgoing ? report.bytesSent : report.bytesReceived;
        const old = previous.get(report.id);
        const rate = old && report.timestamp > old.timestamp ? Math.max(0, (bytes-old.bytes)*8/(report.timestamp-old.timestamp)/1000).toFixed(1) : '—';
        next.set(report.id, {bytes,timestamp:report.timestamp});
        const codec = stats.get(report.codecId)?.mimeType || '—';
        const measurement = {cid, outgoing, width:report.frameWidth, height:report.frameHeight, fps:report.framesPerSecond, rate};
        measurements.push(measurement);
        lines.push(`${name} · ${outgoing ? 'Envoi' : 'Réception'}\n${report.frameWidth || '—'}×${report.frameHeight || '—'} · ${report.framesPerSecond ?? '—'} ips · ${rate} Mbit/s\n${codec} · pertes ${report.packetsLost ?? '—'} · gels ${report.freezeCount ?? '—'}${outgoing ? '\nLimitation : '+(report.qualityLimitationReason || '—')+'\nEncodeur : '+(report.encoderImplementation || '—') : ''}`);
      }
      for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          const pair = stats.get(report.selectedCandidatePairId);
          const candidate = stats.get(pair?.localCandidateId);
          lines.push(`Réseau : ${candidate?.candidateType || '—'} · RTT ${pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime*1000)+' ms' : '—'}`);
        }
      }
      previousStats.set(cid,next);
    }
    $('mediaStats').textContent = lines.join('\n\n') || 'Aucune connexion vidéo';
    const primary = measurements.find(m => !m.outgoing && m.width) || measurements.find(m => m.width);
    $('metricResolution').textContent = primary?.height ? `${primary.height}p` : '—';
    $('metricFps').textContent = primary?.fps != null ? Math.round(primary.fps) : '—';
    $('metricBitrate').textContent = primary?.rate || '—';
    $('metricContext').textContent = primary
      ? `${primary.outgoing ? 'Envoyé à' : 'Reçu de'} ${latestUsersById[primary.cid]?.name || 'Participant'}`
      : 'En attente d’un échange vidéo';
    for (const [cid, stream] of Object.entries(remoteScreenStreams)) {
      const m = measurements.find(item => item.cid === cid && !item.outgoing && item.width);
      const badge = document.getElementById(`screen-quality-${cid}`);
      if (badge) badge.textContent = m ? `Reçu · ${m.width} × ${m.height} · ${Math.round(m.fps || 0)} ips` : 'Réception · mesure en cours';
    }
    if (screenVideoTrack) {
      const settings = screenVideoTrack.getSettings();
      const badge = document.getElementById(`screen-quality-${clientId}`);
      if (badge) badge.textContent = `Aperçu local · ${settings.width || '—'} × ${settings.height || '—'}`;
    }
  } catch (error) { console.warn('Diagnostic indisponible', error); }
  finally { diagnosticsRunning = false; }
}
setInterval(collectDiagnostics, 2000);
document.addEventListener('click', () => {
  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    if (!audio.muted && audio.paused) audio.play().catch(() => {});
  });
});


// --- 6. VOCAL + PARTAGE D'ÉCRAN (WEBRTC INDÉPENDANTS) ---
async function toggleVoiceChannel() {
  if (!transportReady) { showToast("Attendez la connexion au salon"); return; }
  if (!inVoice) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      inVoice = true;
      $("voiceToggleBtn").classList.add("active");
      $("voiceBtnText").textContent = "Quitter le vocal";
      showToast("Connecté au canal vocal 🎙️");

    } catch (err) {
      console.error("Erreur microphone :", err);
      alert("Impossible d'accéder au microphone.\n\nErreur : " + err.name + "\n" + err.message);
      return;
    }
  } else {
    await leaveVoice();
  }
  getState();
}

async function leaveVoice() {
  inVoice = false;

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  document.querySelectorAll('#audioContainer audio').forEach(audio => { if (audio.dataset.kind === "microphone") audio.muted = true; });
  $("voiceToggleBtn").classList.remove("active");
  $("voiceBtnText").textContent = "Rejoindre le vocal";
  showToast("Déconnecté du vocal");
  getState();
}

async function toggleScreenShare() {
  if (screenStream) {
    await stopScreenShare();
    return;
  }

  if (screenStarting) return;
  if (!transportReady) { showToast('Attendez la connexion au salon'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('Le partage nécessite HTTPS ou localhost et un navigateur compatible'); return;
  }
  screenStarting = true;
  try {
    const p = selectedProfile();
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width:{ideal:p.width,max:p.width}, height:{ideal:p.height,max:p.height}, frameRate:{ideal:p.fps,max:p.fps} },
      audio: $('shareAudio').checked,
      systemAudio: 'include'
    });

    screenVideoTrack = screenStream.getVideoTracks()[0] || null;
    if (!screenVideoTrack) throw new Error("Aucune piste vidéo reçue");
    screenVideoTrack.contentHint = selectedProfile().hint;
    $('shareAudio').disabled = true;
    if ($('shareAudio').checked && !screenStream.getAudioTracks().length) showToast('Le son système est indisponible pour cette source');

    $("screenShareBtn").classList.add("active");
    $("screenShareBtnText").textContent = "Arrêter le partage";

    addOrUpdateScreenTile(clientId, screenStream, `${username} · Vous`, true);
    screenVideoTrack.onended = () => stopScreenShare();

    // getState() annoncera immédiatement que nous partageons.
    await getState();
    showToast("Partage d'écran démarré 🖥️");
  } catch (err) {
    console.error("Erreur partage d'écran :", err);
    if (screenStream) await stopScreenShare();
    screenStream = null;
    screenVideoTrack = null;
    if (err.name !== "NotAllowedError") showToast("Impossible de partager l'écran");
  } finally { screenStarting = false; }
}

async function stopScreenShare() {
  if (!screenStream && !screenVideoTrack) return;

  const oldTracks = screenStream ? screenStream.getTracks() : [];
  screenVideoTrack = null;

  if (screenStream) {
    screenStream.getTracks().forEach(t => {
      t.onended = null;
      t.stop();
    });
    screenStream = null;
  }

  $("screenShareBtn").classList.remove("active");
  $("screenShareBtnText").textContent = "Partager l'écran";
  removeScreenTile(clientId);

  $('shareAudio').disabled = false;
  for (const pc of Object.values(peerConnections)) {
    for (const sender of pc.getSenders()) {
      if (oldTracks.includes(sender.track)) pc.removeTrack(sender);
    }
  }

  await getState();
  showToast("Partage d'écran arrêté");
}

function addOrUpdateScreenTile(cid, stream, label, isLocal = false) {
  if (!isLocal) remoteScreenStreams[cid] = stream;

  let tile = document.getElementById(`screen-tile-${cid}`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "screen-tile";
    tile.id = `screen-tile-${cid}`;
    tile.innerHTML = `
      <video id="screen-video-${cid}" autoplay playsinline></video>
      <div class="screen-quality" id="screen-quality-${cid}"></div>
      <div class="screen-tile-header">
        <div class="screen-label" id="screen-label-${cid}"></div>
        <div class="screen-actions">
          <button class="screen-action" type="button" title="Agrandir" onclick="toggleExpandScreen('${cid}')">⤢</button>
          <button class="screen-action" type="button" title="Plein écran" onclick="fullscreenScreen('${cid}')">⛶</button>
        </div>
      </div>
    `;
    $("screenGrid").appendChild(tile);
  }

  const video = document.getElementById(`screen-video-${cid}`);
  const labelEl = document.getElementById(`screen-label-${cid}`);
  labelEl.textContent = label;
  const badge = document.getElementById(`screen-quality-${cid}`);
  badge.textContent = isLocal ? 'Aperçu local · avant transmission' : 'Réception · mesure en cours';
  video.srcObject = stream;
  video.muted = true;
  video.play().catch(() => {});
  $("screenStage").classList.add("show");
}

function removeScreenTile(cid) {
  const tile = document.getElementById(`screen-tile-${cid}`);
  if (tile?.classList.contains("app-fullscreen")) closeAppFullscreen();
  if (tile) tile.remove();
  delete remoteScreenStreams[cid];

  if (expandedScreenId === cid) closeExpandedScreen();
  if (!$("screenGrid").children.length) $("screenStage").classList.remove("show");
}

function toggleExpandScreen(cid) {
  const tile = document.getElementById(`screen-tile-${cid}`);
  if (!tile) return;

  if (expandedScreenId === cid) {
    closeExpandedScreen();
    return;
  }

  closeExpandedScreen();
  expandedScreenId = cid;
  tile.classList.add("expanded");
  $("screenBackdrop").classList.add("show");
}

function closeExpandedScreen() {
  if (expandedScreenId) {
    const tile = document.getElementById(`screen-tile-${expandedScreenId}`);
    if (tile) tile.classList.remove("expanded");
  }
  expandedScreenId = null;
  $("screenBackdrop").classList.remove("show");
}

function fullscreenScreen(cid) {
  const tile = document.getElementById(`screen-tile-${cid}`);
  if (!tile) return;

  const alreadyFullscreen = tile.classList.contains("app-fullscreen");
  closeAppFullscreen();

  if (!alreadyFullscreen) {
    closeExpandedScreen();
    tile.classList.add("app-fullscreen");
    document.body.classList.add("screen-fullscreen-active");
  }
}

function closeAppFullscreen() {
  document.querySelectorAll(".screen-tile.app-fullscreen").forEach(tile => {
    tile.classList.remove("app-fullscreen");
  });
  document.body.classList.remove("screen-fullscreen-active");
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (document.querySelector(".screen-tile.app-fullscreen")) {
      closeAppFullscreen();
      return;
    }
    if (expandedScreenId) closeExpandedScreen();
  }
});

async function renegotiatePeer(targetCid, pc) {
  const state = peerState[targetCid];
  if (!state || state.makingOffer || pc.signalingState !== 'stable' || !transportReady) return;
  try {
    state.makingOffer = true;
    await pc.setLocalDescription();
    await sendSignal(targetCid, { sdp:pc.localDescription });
  } catch (error) { console.error('Négociation', error); }
  finally { state.makingOffer = false; }
}

async function handleWebRTCSignals(signals) {
  for (const {from:cid, signal} of signals) {
    if (!latestUsers.some(u => u.id === cid)) continue;
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

function createPeerConnection(cid) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[cid] = pc;
  peerState[cid] = { polite:clientId > cid, makingOffer:false, settingAnswer:false, ignoreOffer:false, candidates:[] };
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
      addOrUpdateScreenTile(cid, stream, `${latestUsersById[cid]?.name || 'Participant'} partage son écran`, false);
      track.onended = () => removeScreenTile(cid);
    } else {
      // Vidéos muettes : chaque piste audio possède une seule sortie dédiée.
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

async function sendSignal(target, signal) {
  if (signalSocket?.readyState !== WebSocket.OPEN) throw new Error('Signalisation déconnectée');
  if (signal.sdp) signal.media = {microphone:localStream?.id, screen:screenStream?.id};
  signalSocket.send(JSON.stringify({type:'signal',target,signal}));
}

function updateRemoteAudio(cid) {
  const user = latestUsersById[cid];
  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    if (audio.dataset.peer !== cid) return;
    audio.muted = audio.dataset.kind === 'microphone'
      ? !(inVoice && user?.in_voice)
      : !($('receiveScreens').checked && user?.sharing_screen);
  });
}

async function getState() {
  Object.keys(peerConnections).forEach(updateRemoteAudio);
  updatePresence();
}

async function applyState(data) {
  connectionEl.textContent = 'Connecté';
  latestUsers = data.users || [];
  latestUsersById = Object.fromEntries(latestUsers.map(u => [u.id,u]));
  renderUsers(latestUsers, data.voice_users || []);
  if (data.messages) renderMessages(data.messages);
  const needed = new Set();
  for (const user of latestUsers) {
    if (user.id === clientId) continue;
    if ((inVoice && user.in_voice) || (screenStream && user.receive_screens) || (user.sharing_screen && $('receiveScreens').checked)) {
      needed.add(user.id);
      const pc = peerConnections[user.id] || createPeerConnection(user.id);
      await syncPeerTracks(user.id,pc);
      await Promise.all(pc.getSenders().map(configureVideoSender));
    }
    updateRemoteAudio(user.id);
    if (!user.sharing_screen || !$('receiveScreens').checked) removeScreenTile(user.id);
  }
  for (const cid of Object.keys(peerConnections)) if (!needed.has(cid)) closePeer(cid);
  // Supprimer aussi les sorties de flux devenus inactifs sans événement ended distant.
  document.querySelectorAll('#audioContainer audio').forEach(audio => {
    const user = latestUsersById[audio.dataset.peer];
    if (!user || (!user.in_voice && !user.sharing_screen)) audio.remove();
  });
}


window.addEventListener('beforeunload', () => {
  clearTimeout(reconnectTimer);
  if (signalSocket) { signalSocket.onclose = null; signalSocket.close(); }
  Object.values(peerConnections).forEach(pc => pc.close());
  screenStream?.getTracks().forEach(track => track.stop());
  localStream?.getTracks().forEach(track => track.stop());
});


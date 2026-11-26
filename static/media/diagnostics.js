// Live video statistics shown in Settings > Diagnostic and on each screen tile.
import { $ } from '../util.js';
import { getClientId } from '../session.js';
import { media, peerConnections, previousStats, remoteScreenStreams } from './state.js';

export async function collectDiagnostics() {
  if (media.diagnosticsRunning) return;
  media.diagnosticsRunning = true;
  const lines = [];
  const measurements = [];
  try {
    for (const [cid, pc] of Object.entries(peerConnections)) {
      const stats = await pc.getStats();
      const previous = previousStats.get(cid) || new Map();
      const next = new Map();
      const name = media.usersById[cid]?.name || 'Participant';
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
      ? `${primary.outgoing ? 'Envoyé à' : 'Reçu de'} ${media.usersById[primary.cid]?.name || 'Participant'}`
      : 'En attente d’un échange vidéo';
    for (const cid of Object.keys(remoteScreenStreams)) {
      const m = measurements.find(item => item.cid === cid && !item.outgoing && item.width);
      const badge = document.getElementById(`screen-quality-${cid}`);
      if (badge) badge.textContent = m ? `Reçu · ${m.width} × ${m.height} · ${Math.round(m.fps || 0)} ips` : 'Réception · mesure en cours';
    }
    if (media.screenVideoTrack) {
      const settings = media.screenVideoTrack.getSettings();
      const badge = document.getElementById(`screen-quality-${getClientId()}`);
      if (badge) badge.textContent = `Aperçu local · ${settings.width || '—'} × ${settings.height || '—'}`;
    }
  } catch (error) { console.warn('Diagnostic indisponible', error); }
  finally { media.diagnosticsRunning = false; }
}

export function initDiagnostics() {
  setInterval(collectDiagnostics, 2000);
}

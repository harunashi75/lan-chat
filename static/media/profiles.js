// Screen-share quality profiles and encoder settings.
import { $, showToast } from '../util.js';
import { getClientId, getVideoBudget } from '../session.js';
import { media, peerConnections } from './state.js';

export const VIDEO_PROFILES = {
  text: { width:1920, height:1080, fps:20, bitrate:6000000, hint:'text', degradation:'maintain-resolution' },
  balanced: { width:1920, height:1080, fps:30, bitrate:10000000, hint:'detail', degradation:'balanced' },
  motion: { width:1920, height:1080, fps:60, bitrate:16000000, hint:'motion', degradation:'maintain-framerate' },
  detail: { width:2560, height:1440, fps:30, bitrate:16000000, hint:'detail', degradation:'maintain-resolution' }
};

export const selectedProfile = () => VIDEO_PROFILES[$('videoProfile').value];

export async function configureVideoSender(sender) {
  if (sender.track?.kind !== 'video') return;
  const profile = selectedProfile();
  const params = sender.getParameters();
  if (!params.encodings?.length) return;
  const viewers = Math.max(1, media.users.filter(u => u.id !== getClientId() && u.receive_screens).length);
  // Total budget (configurable) shared between the viewers in peer-to-peer mode.
  const totalBudget = Number(getVideoBudget());
  params.encodings.forEach(encoding => {
    encoding.maxBitrate = Math.min(profile.bitrate, Math.floor(totalBudget / viewers));
    encoding.maxFramerate = profile.fps;
  });
  params.degradationPreference = profile.degradation;
  try { await sender.setParameters(params); }
  catch (error) { console.warn('Encoder settings not applied', error); }
}

export async function changeVideoProfile() {
  localStorage.setItem('lan_video_profile', $('videoProfile').value);
  if (!media.screenVideoTrack) return;
  const p = selectedProfile();
  media.screenVideoTrack.contentHint = p.hint;
  try {
    await media.screenVideoTrack.applyConstraints({width:{ideal:p.width,max:p.width},height:{ideal:p.height,max:p.height},frameRate:{ideal:p.fps,max:p.fps}});
    await Promise.all(Object.values(peerConnections).flatMap(pc => pc.getSenders().map(configureVideoSender)));
  } catch (error) { console.error(error); showToast('Ce profil ne peut pas être appliqué sur cette source'); }
}

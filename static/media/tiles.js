// Screen tiles: one <video> per shared screen, with expand and fullscreen views.
import { $ } from '../util.js';
import { media, remoteScreenStreams } from './state.js';

export function addOrUpdateScreenTile(cid, stream, label, isLocal = false) {
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
          <button class="screen-action" type="button" title="Agrandir" data-action="expand">⤢</button>
          <button class="screen-action" type="button" title="Plein écran" data-action="fullscreen">⛶</button>
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

export function removeScreenTile(cid) {
  const tile = document.getElementById(`screen-tile-${cid}`);
  if (tile?.classList.contains("app-fullscreen")) closeAppFullscreen();
  if (tile) tile.remove();
  delete remoteScreenStreams[cid];

  if (media.expandedScreenId === cid) closeExpandedScreen();
  if (!$("screenGrid").children.length) $("screenStage").classList.remove("show");
}

export function toggleExpandScreen(cid) {
  const tile = document.getElementById(`screen-tile-${cid}`);
  if (!tile) return;

  if (media.expandedScreenId === cid) {
    closeExpandedScreen();
    return;
  }

  closeExpandedScreen();
  media.expandedScreenId = cid;
  tile.classList.add("expanded");
  $("screenBackdrop").classList.add("show");
}

export function closeExpandedScreen() {
  if (media.expandedScreenId) {
    const tile = document.getElementById(`screen-tile-${media.expandedScreenId}`);
    if (tile) tile.classList.remove("expanded");
  }
  media.expandedScreenId = null;
  $("screenBackdrop").classList.remove("show");
}

export function fullscreenScreen(cid) {
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

export function closeAppFullscreen() {
  document.querySelectorAll(".screen-tile.app-fullscreen").forEach(tile => {
    tile.classList.remove("app-fullscreen");
  });
  document.body.classList.remove("screen-fullscreen-active");
}

export function initTiles() {
  $('screenBackdrop').addEventListener('click', closeExpandedScreen);
  $('screenGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    const tile = button?.closest('.screen-tile');
    if (!tile) return;
    const cid = tile.id.slice('screen-tile-'.length);
    if (button.dataset.action === 'expand') toggleExpandScreen(cid);
    else if (button.dataset.action === 'fullscreen') fullscreenScreen(cid);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.screen-tile.app-fullscreen')) closeAppFullscreen();
    else if (media.expandedScreenId) closeExpandedScreen();
  });
}

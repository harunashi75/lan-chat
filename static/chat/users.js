// "En ligne" list in the sidebar.
import { $, initials, escapeHtml, avatarHue } from "../util.js";
import { getClientId } from "../session.js";
import { isSpeaking, onSpeakingChange } from "../speaking.js";
import { getVolume, isMuted, setVolume, setMuted } from "../voice-prefs.js";

let users = [];
let usersById = {};
let lastSnapshot = "";

export const getUsers = () => users;
export const userName = id => usersById[id]?.name;

// Draw or remove the speaking ring on every avatar of that person (sidebar list and voice list).
onSpeakingChange((id, value) => {
  document.querySelectorAll(`[data-user-id="${CSS.escape(id)}"]`).forEach(el => el.classList.toggle("speaking", value));
});

export function renderUsers(list, voiceUsers = []) {
  users = list || [];
  usersById = Object.fromEntries(users.map(user => [user.id, user]));
  const inVoice = new Set(voiceUsers.map(user => user.id));
  $("onlineCount").textContent = users.length;
  $("voiceCount").textContent = `${voiceUsers.length} connecté${voiceUsers.length > 1 ? "s" : ""}`;

  // Skip the DOM work when nothing visible changed.
  const snapshot = JSON.stringify({ users, voice: Array.from(inVoice) });
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  renderVoiceMembers(voiceUsers);

  const container = $("users");
  container.innerHTML = "";
  if (!users.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:13px">Personne en ligne</div>';
    return;
  }
  for (const user of users) {
    const row = document.createElement("div");
    row.className = "user";
    row.innerHTML = `
      <div class="avatar${inVoice.has(user.id) ? " in-voice" : ""}${isSpeaking(user.id) ? " speaking" : ""}" data-user-id="${escapeHtml(user.id)}" style="--h:${avatarHue(user.id)}">${escapeHtml(initials(user.name))}</div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(user.name)}${user.id === getClientId() ? ' <span class="you-tag">vous</span>' : ""}</div>
        <div class="user-status">
          <span class="dot"></span>En ligne
          ${inVoice.has(user.id) ? `<span class="voice-badge${user.muted ? " is-muted" : ""}">${user.muted ? "🔇 Micro coupé" : "🎙️ En vocal"}</span>` : ""}
        </div>
      </div>`;
    container.appendChild(row);
  }
}

// ---- Voice channel list: who is in, who is muted, and your own volume per person ----
let voiceMembers = [];            // last { id, name } list received
const openControls = new Set();   // ids whose volume panel is expanded

function memberRow(user) {
  const me = user.id === getClientId();
  const isMutedByThem = Boolean(usersById[user.id]?.muted);
  const mutedHere = !me && isMuted(user.id);
  const adjust = me ? "" : `
      <button class="voice-member-adjust${mutedHere ? " is-muted" : ""}" type="button" data-adjust="${escapeHtml(user.id)}"
        aria-expanded="${openControls.has(user.id)}" aria-label="Régler le volume de ${escapeHtml(user.name)}"
        title="Volume de ${escapeHtml(user.name)}">${mutedHere ? "🔇" : "🔊"}</button>`;
  const percent = Math.round(getVolume(user.id) * 100);
  const controls = !me && openControls.has(user.id) ? `
    <div class="voice-controls">
      <input type="range" min="0" max="200" step="5" value="${percent}" data-volume="${escapeHtml(user.id)}"
        aria-label="Volume de ${escapeHtml(user.name)}">
      <output>${percent}%</output>
      <button class="voice-controls-mute${mutedHere ? " active" : ""}" type="button" data-mute="${escapeHtml(user.id)}"
        aria-pressed="${mutedHere}">${mutedHere ? "Rétablir le son" : "Rendre muet"}</button>
    </div>` : "";
  return `
    <div class="voice-member-block">
      <div class="voice-member" data-member="${escapeHtml(user.id)}">
        <span class="avatar${isSpeaking(user.id) ? " speaking" : ""}" data-user-id="${escapeHtml(user.id)}" style="--h:${avatarHue(user.id)}">${escapeHtml(initials(user.name))}</span>
        <span class="voice-member-name">${escapeHtml(user.name)}</span>
        <span class="voice-member-mic${isMutedByThem ? " is-muted" : ""}" title="${isMutedByThem ? "Micro coupé" : "Micro actif"}">${isMutedByThem ? "🔇" : "🎙️"}</span>${adjust}
      </div>${controls}
    </div>`;
}

function renderVoiceMembers(voiceUsers = voiceMembers) {
  voiceMembers = voiceUsers;
  for (const id of [...openControls]) if (!voiceUsers.some(user => user.id === id)) openControls.delete(id);
  $("voiceMembers").innerHTML = voiceUsers.map(memberRow).join("");
}

export function initUsers() {
  const list = $("voiceMembers");
  list.addEventListener("click", event => {
    const adjust = event.target.closest("[data-adjust]");
    const mute = event.target.closest("[data-mute]");
    if (adjust) {
      const id = adjust.dataset.adjust;
      if (openControls.has(id)) openControls.delete(id);
      else openControls.add(id);
      renderVoiceMembers();
    } else if (mute) {
      setMuted(mute.dataset.mute, !isMuted(mute.dataset.mute));
      renderVoiceMembers();
    }
  });
  // Dragging the slider only updates the number: re-rendering here would drop the drag.
  list.addEventListener("input", event => {
    const slider = event.target.closest("[data-volume]");
    if (!slider) return;
    setVolume(slider.dataset.volume, Number(slider.value) / 100);
    slider.nextElementSibling.textContent = `${slider.value}%`;
  });
}

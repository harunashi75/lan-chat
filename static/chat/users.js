// "En ligne" list in the sidebar.
import { $, initials, escapeHtml } from "../util.js";
import { getClientId } from "../session.js";

let users = [];
let usersById = {};
let lastSnapshot = "";

export const getUsers = () => users;
export const userName = id => usersById[id]?.name;

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
      <div class="avatar">${escapeHtml(initials(user.name))}</div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(user.name)}${user.id === getClientId() ? ' <span class="you-tag">vous</span>' : ""}</div>
        <div class="user-status">
          <span class="dot"></span>En ligne
          ${inVoice.has(user.id) ? '<span class="voice-badge">🎙️ En vocal</span>' : ""}
        </div>
      </div>`;
    container.appendChild(row);
  }
}

// Chat interface: users, messages, reactions, emoji picker, theme and join flow.
import { $, showToast, initials, escapeHtml } from "./util.js";
import { emojiData, emojiIcons, renderMessageText, bindEmojiFallback, isAnimatedEmojiOnly } from "./emoji.js";
import { on, connect, send, setName, setPassword, getName, getPassword, getClientId,
         getSocket, isReady } from "./session.js";
import { initMedia, mediaDebug } from "./media.js";

const messagesEl = $("messages");
const usersEl = $("users");
const input = $("messageInput");
const sendButton = $("sendButton");
const emojiPicker = $("emojiPicker");
const overlay = $("overlay");
const nameInput = $("nameInput");
const passwordInput = $("passwordInput");
const joinButton = $("joinButton");
const connectionEl = $("connection");
const emptyEl = $("empty");
const themeToggle = $("themeToggle");
const themeIcon = $("themeIcon");
const themeText = $("themeText");
const settingsBox = $("settingsBox");
const settingsToggle = $("settingsToggle");

// --- 1. ÉTAT LOCAL ---
let latestUsers = [];
let latestUsersById = {};
// Animated emoji are loaded from Google's servers: off unless the user opts in.
let animatedEmoji = localStorage.getItem("lan_chat_animated_emoji") === "1";
let lastUsersSnapshot = "";
let joined = false;

if (getName()) nameInput.value = getName();

// --- 3. THÈME ---
const savedTheme = localStorage.getItem("lan_chat_theme");
if (savedTheme === "dark") {
  document.body.classList.add("dark-mode");
  themeIcon.textContent = "☀️";
  themeText.textContent = "Mode clair";
}

themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  const isDark = document.body.classList.contains("dark-mode");
  themeIcon.textContent = isDark ? "☀️" : "🌙";
  themeText.textContent = isDark ? "Mode clair" : "Mode sombre";
  localStorage.setItem("lan_chat_theme", isDark ? "dark" : "light");
});

settingsToggle.addEventListener("click", () => {
  settingsBox.classList.toggle("open");
  if (settingsBox.classList.contains("open")) $("renameInput").value = getName();
});

function renameSelf(){
  const name = $("renameInput").value.trim().slice(0,32);
  if(!name || !joined) return;
  setName(name);
  showToast("Nom mis à jour");
}
const animatedToggle = $("animatedEmoji");
animatedToggle.checked = animatedEmoji;
animatedToggle.addEventListener("change", () => setAnimatedEmoji(animatedToggle.checked));
$("renameButton").addEventListener("click", renameSelf);
$("renameInput").addEventListener("keydown", event => { if(event.key === "Enter") renameSelf(); });

// --- 4. AFFICHAGE DES UTILISATEURS ---
function renderUsers(list, voiceUsers = []){
  latestUsers = list || [];
  latestUsersById = Object.fromEntries((list || []).map(u => [u.id, u]));
  const voiceMap = new Set(voiceUsers.map(v => v.id));
  $("voiceCount").textContent = `${voiceUsers.length} connecté${voiceUsers.length > 1 ? 's' : ''}`;

  const snapshot = JSON.stringify({ u: list, v: Array.from(voiceMap) });
  if(snapshot === lastUsersSnapshot) return;
  lastUsersSnapshot = snapshot;

  usersEl.innerHTML = "";
  if(!list || !list.length){
    usersEl.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:13px">Personne en ligne</div>';
    return;
  }

  list.forEach(user => {
    const isUserInVoice = voiceMap.has(user.id);
    const row = document.createElement("div");
    row.className = "user";
    row.innerHTML = `
      <div class="avatar">${escapeHtml(initials(user.name))}</div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(user.name)}</div>
        <div class="user-status">
          <span class="dot"></span>En ligne
          ${isUserInVoice ? '<span class="voice-badge">🎙️ En vocal</span>' : ''}
        </div>
      </div>
    `;
    usersEl.appendChild(row);
  });
}

// --- 5. AFFICHAGE DES MESSAGES & RÉACTIONS (rendu incrémental) ---
const MAX_MESSAGES = 200;
const messageRows = new Map(); // msg_id -> { row, msg, reactions }

function renderBubble(row, msg){
  const bubble = row.querySelector(".bubble");
  bubble.innerHTML = renderMessageText(msg.text, animatedEmoji);
  bindEmojiFallback(bubble);
}

function setAnimatedEmoji(value){
  animatedEmoji = value;
  localStorage.setItem("lan_chat_animated_emoji", value ? "1" : "0");
  messageRows.forEach(entry => renderBubble(entry.row, entry.msg));
}

function nearBottom(){
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
}

function buildMessageRow(msg){
  const mine = msg.id ? (msg.id === getClientId()) : (msg.name === getName());
  const row = document.createElement("div");
  row.className = "message-row" + (mine ? " mine" : "");
  const time = msg.time ? new Date(msg.time * 1000) : new Date();
  const timeText = time.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  const id = escapeHtml(msg.msg_id);
  row.innerHTML = `
    <div class="message">
      <button class="react-btn-trigger" data-action="picker">➕</button>
      <div class="quick-react-picker" id="picker-${id}">
        ${["👍","❤️","🔥","😂","🎉","👀"].map(e => `<button class="quick-react-btn" data-emoji="${e}">${e}</button>`).join("")}
      </div>
      <div class="message-avatar">${escapeHtml(initials(msg.name))}</div>
      <div class="message-body">
        <div class="meta">${escapeHtml(msg.name)} · ${timeText}</div>
        <div class="bubble ${isAnimatedEmojiOnly(msg.text) ? 'emoji-only-bubble' : ''}"></div>
        <div class="reactions-bar"></div>
      </div>
    </div>`;
  renderBubble(row, msg);
  row.querySelector('[data-action="picker"]').addEventListener('click', event => togglePicker(event, msg.msg_id));
  row.querySelectorAll('.quick-react-btn').forEach(button => {
    button.addEventListener('click', event => toggleReaction(event, msg.msg_id, button.dataset.emoji));
  });
  return row;
}

function applyReactions(msgId, reactions, animate){
  const entry = messageRows.get(msgId);
  if(!entry) return;
  const previous = entry.reactions || {};
  const bar = entry.row.querySelector(".reactions-bar");
  bar.textContent = "";
  for (const [emoji, ids] of Object.entries(reactions || {})) {
    const badge = document.createElement("div");
    badge.className = "reaction-badge" + (ids.includes(getClientId()) ? " active" : "");
    badge.title = ids.map(id => latestUsersById[id]?.name || "Ancien participant").join(", ");
    badge.dataset.reaction = emoji;
    badge.innerHTML = `<span>${escapeHtml(emoji)}</span><span>${ids.length}</span>`;
    badge.addEventListener("click", event => toggleReaction(event, msgId, emoji));
    if (animate && (previous[emoji]?.length || 0) !== ids.length) badge.classList.add("reaction-pop");
    bar.appendChild(badge);
  }
  entry.reactions = reactions || {};
}

function addMessage(msg, scroll = true){
  if(messageRows.has(msg.msg_id)) return;
  const stick = scroll && (nearBottom() || msg.id === getClientId());
  emptyEl.style.display = "none";
  const row = buildMessageRow(msg);
  messageRows.set(msg.msg_id, { row, msg, reactions: {} });
  messagesEl.appendChild(row);
  applyReactions(msg.msg_id, msg.reactions, false);
  while(messageRows.size > MAX_MESSAGES){
    const [oldId, old] = messageRows.entries().next().value;
    old.row.remove();
    messageRows.delete(oldId);
  }
  if(stick) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Full state, received once when joining or reconnecting.
function renderMessages(list){
  messageRows.forEach(entry => entry.row.remove());
  messageRows.clear();
  emptyEl.style.display = list && list.length ? "none" : "block";
  (list || []).forEach(msg => addMessage(msg, false));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function togglePicker(event, msgId) {
  event.stopPropagation();

  document.querySelectorAll('.quick-react-picker').forEach(p => {
    if (p.id !== `picker-${msgId}`) p.classList.remove('open');
  });

  const picker = $(`picker-${msgId}`);
  if (picker) picker.classList.toggle('open');
}

function toggleReaction(event, msgId, emoji) {
  if (event) event.stopPropagation();
  if (!send({ type:"react", msg_id:msgId, emoji })) {
    showToast("Erreur lors de la réaction");
    return;
  }
  const picker = $(`picker-${msgId}`);
  if (picker) picker.classList.remove('open');
}

function sendMessage(){
  const text = input.value.trim();
  if(!text || !joined) return;
  if(!send({ type:"message", text })){
    showToast("Impossible d'envoyer le message");
    connectionEl.innerHTML = '<span class="dot" style="background:#ff3b30"></span>Connexion interrompue';
    return;
  }
  input.value = "";
  input.style.height = "40px";
  updateSendButton();
  input.focus();
}

function buildEmojiPicker(){
  const tabs = $("emojiTabs");

  Object.keys(emojiData).forEach((category, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-tab" + (index === 0 ? " active" : "");
    button.textContent = emojiIcons[category];
    button.onclick = () => {
      tabs.querySelectorAll(".emoji-tab").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      showEmojis(category);
    };
    tabs.appendChild(button);
  });

  showEmojis("smileys");
}

function showEmojis(category){
  const grid = $("emojiGrid");
  grid.innerHTML = "";

  emojiData[category].forEach(emoji => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji";
    button.textContent = emoji;

    button.onclick = () => {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.slice(0,start) + emoji + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
      updateSendButton();
    };

    grid.appendChild(button);
  });
}

function updateSendButton(){
  sendButton.disabled = !input.value.trim() || !joined;
}

input.addEventListener("input", () => {
  input.style.height = "40px";
  input.style.height = Math.min(input.scrollHeight, 130) + "px";
  updateSendButton();
});

input.addEventListener("keydown", event => {
  if(event.key === "Enter" && !event.shiftKey){
    event.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

$("emojiButton").addEventListener("click", event => {
  event.stopPropagation();
  emojiPicker.classList.toggle("open");
});

emojiPicker.addEventListener("click", event => event.stopPropagation());

document.addEventListener("click", () => {
  emojiPicker.classList.remove("open");
  document.querySelectorAll('.quick-react-picker').forEach(p => p.classList.remove('open'));
});

joinButton.addEventListener("click", join);
nameInput.addEventListener("keydown", event => {
  if(event.key === "Enter") join();
});

function join(){
  if (joined) return;
  const name = nameInput.value.trim();
  if(!name){
    nameInput.focus();
    return;
  }

  if(!passwordInput.hidden){
    if(!passwordInput.value){ passwordInput.focus(); return; }
    setPassword(passwordInput.value);
  }
  setName(name.slice(0,32));
  
  joined = true;

  overlay.classList.remove("show");
  input.disabled = false;
  input.focus();

  updateSendButton();
  connect();
}

// Show the password field only when the server asks for one.
fetch("/config").then(r => r.json()).then(config => {
  if(config.passwordRequired){
    passwordInput.hidden = false;
    passwordInput.value = getPassword();
  }
}).catch(() => {});
passwordInput.addEventListener("keydown", event => { if(event.key === "Enter") join(); });

function requirePassword(){
  joined = false;
  setPassword("");
  passwordInput.hidden = false;
  passwordInput.value = "";
  input.disabled = true;
  updateSendButton();
  overlay.classList.add("show");
  passwordInput.focus();
  showToast("Mot de passe incorrect");
}

buildEmojiPicker();
nameInput.focus();

// --- 6. ÉVÉNEMENTS DE LA SESSION ---
async function onState(data){
  connectionEl.textContent = "Connecté";
  renderUsers(data.users || [], data.voice_users || []);
  if (data.messages) renderMessages(data.messages);
}
on("state", onState);
on("users", onState);
on("message", data => addMessage(data.message));
on("reactions", data => applyReactions(data.msg_id, data.reactions, true));
on("error", data => showToast(data.error));
on("status", text => { connectionEl.textContent = text; });
on("needpassword", requirePassword);

initMedia();

// Read-only hook used by the end-to-end browser test.
window.__lanChat = {
  get ready() { return isReady(); },
  get clientId() { return getClientId(); },
  get socket() { return getSocket(); },
  get users() { return latestUsers; },
  get media() { return mediaDebug(); }
};

console.info("Noto Animated Emoji © Google LLC — CC BY 4.0 — https://googlefonts.github.io/noto-emoji-animation/");

// Message list: incremental rendering, reactions and the quick-reaction pickers.
import { $, showToast, initials, escapeHtml } from "../util.js";
import { renderMessageText, bindEmojiFallback, isAnimatedEmojiOnly } from "../emoji.js";
import { send, getName, getClientId } from "../session.js";
import { userName } from "./users.js";

const MAX_MESSAGES = 200;
const QUICK_REACTIONS = ["👍", "❤️", "🔥", "😂", "🎉", "👀"];
const messageRows = new Map(); // msg_id -> { row, msg, reactions }

// Animated emoji are loaded from Google's servers: off unless the user opts in.
let animatedEmoji = localStorage.getItem("lan_chat_animated_emoji") === "1";
export const isAnimatedEmoji = () => animatedEmoji;

function renderBubble(row, msg) {
  const bubble = row.querySelector(".bubble");
  bubble.innerHTML = renderMessageText(msg.text, animatedEmoji);
  bindEmojiFallback(bubble);
}

export function setAnimatedEmoji(value) {
  animatedEmoji = value;
  localStorage.setItem("lan_chat_animated_emoji", value ? "1" : "0");
  messageRows.forEach(entry => renderBubble(entry.row, entry.msg));
}

function nearBottom() {
  const list = $("messages");
  return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
}

function buildMessageRow(msg) {
  const mine = msg.id ? msg.id === getClientId() : msg.name === getName();
  const row = document.createElement("div");
  row.className = "message-row" + (mine ? " mine" : "");
  const time = msg.time ? new Date(msg.time * 1000) : new Date();
  const timeText = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  row.innerHTML = `
    <div class="message">
      <button class="react-btn-trigger" data-action="picker" aria-label="Réagir">➕</button>
      <div class="quick-react-picker" id="picker-${escapeHtml(msg.msg_id)}">
        ${QUICK_REACTIONS.map(e => `<button class="quick-react-btn" data-emoji="${e}">${e}</button>`).join("")}
      </div>
      <div class="message-avatar">${escapeHtml(initials(msg.name))}</div>
      <div class="message-body">
        <div class="meta">${escapeHtml(msg.name)} · ${timeText}</div>
        <div class="bubble ${isAnimatedEmojiOnly(msg.text) ? "emoji-only-bubble" : ""}"></div>
        <div class="reactions-bar"></div>
      </div>
    </div>`;
  renderBubble(row, msg);
  row.querySelector('[data-action="picker"]').addEventListener("click", event => togglePicker(event, msg.msg_id));
  row.querySelectorAll(".quick-react-btn").forEach(button => {
    button.addEventListener("click", event => toggleReaction(event, msg.msg_id, button.dataset.emoji));
  });
  return row;
}

// Reactions arrive as { emoji: [client ids] }.
export function applyReactions(msgId, reactions, animate) {
  const entry = messageRows.get(msgId);
  if (!entry) return;
  const previous = entry.reactions || {};
  const bar = entry.row.querySelector(".reactions-bar");
  bar.textContent = "";
  for (const [emoji, ids] of Object.entries(reactions || {})) {
    const badge = document.createElement("div");
    badge.className = "reaction-badge" + (ids.includes(getClientId()) ? " active" : "");
    badge.title = ids.map(id => userName(id) || "Ancien participant").join(", ");
    badge.dataset.reaction = emoji;
    badge.innerHTML = `<span>${escapeHtml(emoji)}</span><span>${ids.length}</span>`;
    badge.addEventListener("click", event => toggleReaction(event, msgId, emoji));
    if (animate && (previous[emoji]?.length || 0) !== ids.length) badge.classList.add("reaction-pop");
    bar.appendChild(badge);
  }
  entry.reactions = reactions || {};
}

export function addMessage(msg, scroll = true) {
  if (messageRows.has(msg.msg_id)) return;
  const list = $("messages");
  const stick = scroll && (nearBottom() || msg.id === getClientId());
  $("empty").style.display = "none";
  const row = buildMessageRow(msg);
  messageRows.set(msg.msg_id, { row, msg, reactions: {} });
  list.appendChild(row);
  applyReactions(msg.msg_id, msg.reactions, false);
  while (messageRows.size > MAX_MESSAGES) {
    const [oldId, old] = messageRows.entries().next().value;
    old.row.remove();
    messageRows.delete(oldId);
  }
  if (stick) list.scrollTop = list.scrollHeight;
}

// Full history, received once when joining or reconnecting.
export function renderMessages(messages) {
  messageRows.forEach(entry => entry.row.remove());
  messageRows.clear();
  $("empty").style.display = messages?.length ? "none" : "block";
  (messages || []).forEach(msg => addMessage(msg, false));
  $("messages").scrollTop = $("messages").scrollHeight;
}

function closePickers(except = null) {
  document.querySelectorAll(".quick-react-picker").forEach(picker => {
    if (picker.id !== except) picker.classList.remove("open");
  });
}

function togglePicker(event, msgId) {
  event.stopPropagation();
  closePickers(`picker-${msgId}`);
  $(`picker-${msgId}`)?.classList.toggle("open");
}

function toggleReaction(event, msgId, emoji) {
  event?.stopPropagation();
  if (!send({ type: "react", msg_id: msgId, emoji })) {
    showToast("Erreur lors de la réaction");
    return;
  }
  closePickers();
}

export function initMessages() {
  document.addEventListener("click", () => closePickers());
}

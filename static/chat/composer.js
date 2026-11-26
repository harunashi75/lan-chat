// Message input, send button and emoji picker.
import { $, showToast } from "../util.js";
import { emojiData, emojiIcons } from "../emoji.js";
import { send } from "../session.js";
import { setConnection } from "./connection.js";
import { notifyTyping, resetTypingNotice } from "./typing.js";

const input = $("messageInput");
const sendButton = $("sendButton");
const picker = $("emojiPicker");
let enabled = false;

export function setComposerEnabled(value) {
  enabled = value;
  input.disabled = !value;
  updateSendButton();
  if (value) input.focus();
}

function updateSendButton() {
  sendButton.disabled = !enabled || !input.value.trim();
}

function sendMessage() {
  const text = input.value.trim();
  if (!text || !enabled) return;
  if (!send({ type: "message", text })) {
    showToast("Impossible d'envoyer le message");
    setConnection("Connexion interrompue", "err");
    return;
  }
  input.value = "";
  input.style.height = "40px";
  resetTypingNotice();
  updateSendButton();
  input.focus();
}

function insertAtCursor(text) {
  const start = input.selectionStart;
  input.value = input.value.slice(0, start) + text + input.value.slice(input.selectionEnd);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
  updateSendButton();
}

function showEmojis(category) {
  const grid = $("emojiGrid");
  grid.innerHTML = "";
  for (const emoji of emojiData[category]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji";
    button.textContent = emoji;
    button.addEventListener("click", () => insertAtCursor(emoji));
    grid.appendChild(button);
  }
}

function buildEmojiPicker() {
  const tabs = $("emojiTabs");
  Object.keys(emojiData).forEach((category, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-tab" + (index === 0 ? " active" : "");
    button.textContent = emojiIcons[category];
    button.setAttribute("aria-label", category);
    button.addEventListener("click", () => {
      tabs.querySelectorAll(".emoji-tab").forEach(tab => tab.classList.remove("active"));
      button.classList.add("active");
      showEmojis(category);
    });
    tabs.appendChild(button);
  });
  showEmojis("smileys");
}

export function initComposer() {
  buildEmojiPicker();
  input.addEventListener("input", () => {
    input.style.height = "40px";
    input.style.height = Math.min(input.scrollHeight, 130) + "px";
    updateSendButton();
    if (input.value.trim()) notifyTyping();
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  sendButton.addEventListener("click", sendMessage);
  $("emojiButton").addEventListener("click", event => {
    event.stopPropagation();
    picker.classList.toggle("open");
  });
  picker.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", () => picker.classList.remove("open"));
}

// Message input, send button and emoji picker.
import { $, showToast } from "../util.js";
import { emojiData, emojiIcons } from "../emoji.js";
import { send } from "../session.js";
import { prepareImage, uploadImage } from "./images.js";
import { setConnection } from "./connection.js";
import { notifyTyping, resetTypingNotice } from "./typing.js";

const input = $("messageInput");
const sendButton = $("sendButton");
const picker = $("emojiPicker");
let enabled = false;
let sending = false;
let attachment = null; // { blob, w, h, url }: the image waiting to be sent with the next message

export function setComposerEnabled(value) {
  enabled = value;
  input.disabled = !value;
  updateSendButton();
  if (value) input.focus();
}

function updateSendButton() {
  sendButton.disabled = !enabled || sending || (!input.value.trim() && !attachment);
}

function clearAttachment() {
  if (attachment) URL.revokeObjectURL(attachment.url);
  attachment = null;
  $("attachment").hidden = true;
  $("attachmentPreview").removeAttribute("src");
  updateSendButton();
}

async function attachFile(file) {
  if (!enabled || !file) return;
  try {
    const prepared = await prepareImage(file);
    clearAttachment();
    attachment = { ...prepared, url: URL.createObjectURL(prepared.blob) };
    $("attachmentPreview").src = attachment.url;
    $("attachmentInfo").textContent = `${prepared.w} × ${prepared.h} · ${Math.max(1, Math.round(prepared.blob.size / 1024))} Ko`;
    $("attachment").hidden = false;
    $("messages").scrollTop = $("messages").scrollHeight; // the preview shrinks the list: stay at the bottom
    updateSendButton();
    input.focus();
  } catch (error) {
    showToast(error.message);
  }
}

const firstImage = files => [...(files || [])].find(file => file.type.startsWith("image/"));

async function sendMessage() {
  const text = input.value.trim();
  if (!enabled || sending || (!text && !attachment)) return;
  const payload = { type: "message", text };
  if (attachment) {
    sending = true;
    updateSendButton();
    try {
      const id = await uploadImage(attachment.blob);
      payload.image = { id, w: attachment.w, h: attachment.h };
    } catch (error) {
      showToast(error.message);
      sending = false;
      updateSendButton();
      return;
    }
    sending = false;
  }
  if (!send(payload)) {
    showToast("Impossible d'envoyer le message");
    setConnection("Connexion interrompue", "err");
    updateSendButton();
    return;
  }
  input.value = "";
  input.style.height = "40px";
  clearAttachment();
  resetTypingNotice();
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

  // Attach an image: file picker, paste (Ctrl+V) or drag and drop.
  $("attachButton").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", () => {
    attachFile(firstImage($("fileInput").files));
    $("fileInput").value = "";
  });
  $("attachmentRemove").addEventListener("click", clearAttachment);
  document.addEventListener("paste", event => {
    const file = firstImage(event.clipboardData?.files);
    if (!file || !enabled) return;
    event.preventDefault();
    attachFile(file);
  });
  let dragDepth = 0;
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragenter", event => {
    if (!hasFiles(event)) return;
    dragDepth++;
    $("dropZone").classList.add("show");
  });
  document.addEventListener("dragover", event => { if (hasFiles(event)) event.preventDefault(); });
  document.addEventListener("dragleave", event => {
    if (hasFiles(event) && --dragDepth <= 0) { dragDepth = 0; $("dropZone").classList.remove("show"); }
  });
  document.addEventListener("drop", event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    $("dropZone").classList.remove("show");
    attachFile(firstImage(event.dataTransfer.files));
  });
  $("emojiButton").addEventListener("click", event => {
    event.stopPropagation();
    picker.classList.toggle("open");
  });
  picker.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", () => picker.classList.remove("open"));
}

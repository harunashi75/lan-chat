// Sounds (new messages, people joining or leaving the voice channel) and the unread counter
// shown in the tab title and favicon while the window is in the background.
import { $ } from "../util.js";
import { getClientId } from "../session.js";
import { playSound } from "../sounds.js";

const BASE_TITLE = "LAN Chat";
const PREFS = {
  messages: "lan_chat_sound_messages",
  voice: "lan_chat_sound_voice",
  volume: "lan_chat_sound_volume"
};

const flag = (key, fallback = true) => (localStorage.getItem(key) ?? (fallback ? "1" : "0")) === "1";
const volume = () => Number(localStorage.getItem(PREFS.volume) ?? 60) / 100;

let unread = 0;
let previousVoice = null; // ids in the voice channel at the last update; null until the first snapshot
const faviconLink = () => document.querySelector('link[rel="icon"]');
const originalFavicon = faviconLink()?.href;

const away = () => document.hidden || !document.hasFocus();

// ---- Unread counter ---------------------------------------------------------

let iconImage = null;

async function badgedFavicon(count) {
  if (!iconImage) {
    iconImage = new Image();
    iconImage.src = "/static/icon.svg";
    await iconImage.decode();
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(iconImage, 0, 0, 64, 64);
  ctx.fillStyle = "#ff453a";
  ctx.beginPath();
  ctx.arc(46, 18, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(count > 9 ? "9+" : String(count), 46, 19);
  return canvas.toDataURL("image/png");
}

async function showUnread() {
  document.title = unread ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  const link = faviconLink();
  if (!link) return;
  try {
    link.href = unread ? await badgedFavicon(unread) : originalFavicon;
  } catch {
    link.href = originalFavicon; // the badge is a nicety: never break the page for it
  }
}

function clearUnread() {
  if (!unread) return;
  unread = 0;
  showUnread();
}

// ---- Events -----------------------------------------------------------------

// A message from someone else just arrived (not the history sent on join).
export function notifyMessage(message) {
  if (message.id === getClientId() || !away()) return;
  unread += 1;
  showUnread();
  if (flag(PREFS.messages)) playSound("message", volume());
}

// Call with every voice list; the first call after (re)connecting only records the state.
export function trackVoice(voiceUsers) {
  const current = new Set(voiceUsers.map(user => user.id));
  const previous = previousVoice;
  previousVoice = current;
  if (!previous || !flag(PREFS.voice)) return;
  const me = getClientId();
  if (current.has(me) !== previous.has(me)) {
    playSound(current.has(me) ? "voiceJoin" : "voiceLeave", volume());
    return;
  }
  if (!current.has(me)) return; // others coming and going only matter if we are in the channel
  const joined = [...current].some(id => !previous.has(id));
  const left = [...previous].some(id => !current.has(id));
  if (joined) playSound("voiceJoin", volume());
  else if (left) playSound("voiceLeave", volume());
}

export function resetVoiceTracking() {
  previousVoice = null;
}

// ---- Settings controls ------------------------------------------------------

export function initNotifications() {
  window.addEventListener("focus", clearUnread);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) clearUnread(); });

  const bindFlag = (id, key) => {
    const input = $(id);
    input.checked = flag(key);
    input.addEventListener("change", () => localStorage.setItem(key, input.checked ? "1" : "0"));
  };
  bindFlag("soundMessages", PREFS.messages);
  bindFlag("soundVoice", PREFS.voice);

  const slider = $("soundVolume");
  slider.value = String(Math.round(volume() * 100));
  slider.addEventListener("input", () => localStorage.setItem(PREFS.volume, slider.value));
  $("soundTest").addEventListener("click", () => playSound("message", volume()));
}

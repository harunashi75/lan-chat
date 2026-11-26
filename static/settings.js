// Settings window (profile, appearance, screen sharing, diagnostics, about) and the theme.
import { $, showToast, initials, avatarHue } from "./util.js";
import { getName, setName, getClientId } from "./session.js";

const THEME_KEY = "lan_chat_theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let themeMode = "system";
let lastTab = "profile";
let lastFocus = null;

function applyTheme(mode) {
  themeMode = mode;
  const dark = mode === "dark" || (mode === "system" && systemDark.matches);
  document.body.classList.toggle("dark-mode", dark);
  document.querySelectorAll("#themeChoice button").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === mode));
  });
}

function showTab(tab) {
  lastTab = tab;
  document.querySelectorAll(".settings-tab").forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".settings-panel").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  });
}

// The quality cards mirror the hidden <select id="videoProfile">, which media/ reads and listens to.
function syncProfileCards() {
  const current = $("videoProfile").value;
  document.querySelectorAll(".profile-card").forEach(card => {
    card.setAttribute("aria-checked", String(card.dataset.profile === current));
  });
}

function initProfileCards() {
  document.querySelectorAll(".profile-card").forEach(card => {
    card.addEventListener("click", () => {
      $("videoProfile").value = card.dataset.profile;
      $("videoProfile").dispatchEvent(new Event("change"));
      syncProfileCards();
    });
  });
}

export function openSettings(tab = lastTab) {
  lastFocus = document.activeElement;
  syncProfileCards();
  showTab(tab);
  $("renameInput").value = getName();
  $("inviteLink").value = location.origin;
  $("settingsOverlay").classList.add("show");
  $("settingsClose").focus();
}

export function closeSettings() {
  $("settingsOverlay").classList.remove("show");
  lastFocus?.focus?.();
}

const settingsOpen = () => $("settingsOverlay").classList.contains("show");

// Keeps the sidebar chip and the profile panel in sync with the current name.
export function refreshProfile() {
  const name = getName() || "Invité";
  $("selfName").textContent = name;
  $("selfAvatar").textContent = initials(name);
  $("profileName").textContent = name;
  $("profileAvatar").textContent = initials(name);
  for (const id of ["selfAvatar", "profileAvatar"]) $(id).style.setProperty("--h", avatarHue(getClientId()));
}

function renameSelf(isJoined) {
  const name = $("renameInput").value.trim().slice(0, 32);
  if (!name || !isJoined()) return;
  setName(name);
  refreshProfile();
  showToast("Nom mis à jour");
}

async function copyInvite() {
  const input = $("inviteLink");
  try {
    await navigator.clipboard.writeText(input.value);
    showToast("Lien copié");
  } catch {
    // The clipboard API needs a secure context; fall back to selecting the text.
    input.select();
    showToast("Lien sélectionné : Ctrl+C pour copier");
  }
}

export function initSettings({ isJoined, animatedEmoji, onAnimatedEmoji }) {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "dark" || saved === "light" ? saved : "system");
  systemDark.addEventListener("change", () => { if (themeMode === "system") applyTheme("system"); });
  document.querySelectorAll("#themeChoice button").forEach(button => {
    button.addEventListener("click", () => {
      localStorage.setItem(THEME_KEY, button.dataset.theme);
      applyTheme(button.dataset.theme);
    });
  });

  $("settingsOpen").addEventListener("click", () => openSettings());
  $("profileChip").addEventListener("click", () => openSettings("profile"));
  $("settingsClose").addEventListener("click", closeSettings);
  $("settingsOverlay").addEventListener("click", event => {
    if (event.target === $("settingsOverlay")) closeSettings();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && settingsOpen()) closeSettings();
  });
  document.querySelectorAll(".settings-tab").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });

  $("renameButton").addEventListener("click", () => renameSelf(isJoined));
  $("renameInput").addEventListener("keydown", event => { if (event.key === "Enter") renameSelf(isJoined); });
  $("copyInvite").addEventListener("click", copyInvite);
  initProfileCards();

  const animated = $("animatedEmoji");
  animated.checked = animatedEmoji;
  animated.addEventListener("change", () => onAnimatedEmoji(animated.checked));
  refreshProfile();
}

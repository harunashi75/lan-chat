// Welcome dialog: choose a name (and the room password when the server asks for one), then connect.
import { $, showToast } from "../util.js";
import { connect, setName, setPassword, getName, getPassword } from "../session.js";
import { refreshProfile } from "../settings.js";
import { setComposerEnabled } from "./composer.js";

const overlay = $("overlay");
const nameInput = $("nameInput");
const passwordInput = $("passwordInput");
let joined = false;

export const isJoined = () => joined;

function join() {
  if (joined) return;
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  if (!passwordInput.hidden) {
    if (!passwordInput.value) { passwordInput.focus(); return; }
    setPassword(passwordInput.value);
  }
  setName(name.slice(0, 32));
  refreshProfile();
  joined = true;
  overlay.classList.remove("show");
  setComposerEnabled(true);
  connect();
}

// Called when the server rejects the password: ask again.
export function requirePassword() {
  joined = false;
  setPassword("");
  passwordInput.hidden = false;
  passwordInput.value = "";
  setComposerEnabled(false);
  overlay.classList.add("show");
  passwordInput.focus();
  showToast("Mot de passe incorrect");
}

export function initJoin() {
  if (getName()) nameInput.value = getName();
  $("joinButton").addEventListener("click", join);
  nameInput.addEventListener("keydown", event => { if (event.key === "Enter") join(); });
  passwordInput.addEventListener("keydown", event => { if (event.key === "Enter") join(); });
  // Show the password field only when the server asks for one.
  fetch("/config").then(r => r.json()).then(config => {
    if (config.passwordRequired) {
      passwordInput.hidden = false;
      passwordInput.value = getPassword();
    }
  }).catch(() => { /* offline: the join attempt will report it */ });
  nameInput.focus();
}

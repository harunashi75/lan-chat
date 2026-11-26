// "X écrit…" indicator above the composer.
import { $ } from "../util.js";
import { send, getClientId } from "../session.js";

const TYPING_TTL = 5000;   // a hint expires if no new one arrives
const SEND_EVERY = 3000;   // at most one hint every 3 s while typing
const typers = new Map();  // client id -> { name, timer }
let lastSent = 0;

// Called on every keystroke in the composer.
export function notifyTyping() {
  const now = Date.now();
  if (now - lastSent < SEND_EVERY) return;
  lastSent = now;
  send({ type: "typing" });
}

// After sending a message, the next keystroke announces typing again right away.
export function resetTypingNotice() {
  lastSent = 0;
}

function label(names) {
  if (names.length === 1) return `${names[0]} écrit…`;
  if (names.length === 2) return `${names[0]} et ${names[1]} écrivent…`;
  return "Plusieurs personnes écrivent…";
}

function render() {
  const box = $("typing");
  if (!typers.size) { box.replaceChildren(); return; }
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.innerHTML = "<i></i><i></i><i></i>";
  const text = document.createElement("span");
  text.textContent = label([...typers.values()].map(typer => typer.name));
  box.replaceChildren(dots, text);
}

export function clearTyper(id) {
  const typer = typers.get(id);
  if (!typer) return;
  clearTimeout(typer.timer);
  typers.delete(id);
  render();
}

export function onTyping({ id, name }) {
  if (id === getClientId()) return;
  clearTimeout(typers.get(id)?.timer);
  typers.set(id, { name, timer: setTimeout(() => clearTyper(id), TYPING_TTL) });
  render();
}

// Forget people who left the room.
export function pruneTypers(presentIds) {
  for (const id of [...typers.keys()]) if (!presentIds.has(id)) clearTyper(id);
}

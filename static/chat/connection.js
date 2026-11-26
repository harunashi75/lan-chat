// Connection status pill in the header.
import { $ } from "../util.js";

export function setConnection(text, state) {
  const pill = $("connection");
  pill.dataset.state = state; // "ok" | "warn" | "err", styled in style.css
  const dot = document.createElement("span");
  dot.className = "dot";
  pill.replaceChildren(dot, text);
}

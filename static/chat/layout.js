// Mobile layout: the sidebar becomes a drawer opened from the header.
import { $ } from "../util.js";

function setDrawer(open) {
  $("sidebar").classList.toggle("open", open);
  $("drawerBackdrop").classList.toggle("show", open);
}

export function initLayout() {
  $("menuButton").addEventListener("click", () => setDrawer(!$("sidebar").classList.contains("open")));
  $("drawerBackdrop").addEventListener("click", () => setDrawer(false));
}

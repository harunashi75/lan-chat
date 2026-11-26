// Full-size view of an image: click to open, click outside or Escape to close.
import { $ } from "../util.js";

export const isLightboxOpen = () => !$("lightbox").hidden;

export function openLightbox(src) {
  $("lightboxImage").src = src;
  $("lightbox").hidden = false;
}

function closeLightbox() {
  $("lightbox").hidden = true;
  $("lightboxImage").removeAttribute("src");
}

export function initLightbox() {
  $("lightbox").addEventListener("click", event => {
    if (event.target !== $("lightboxImage")) closeLightbox();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && isLightboxOpen()) {
      event.stopImmediatePropagation(); // do not also close the settings window underneath
      closeLightbox();
    }
  }, true);
}

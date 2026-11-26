// Preparing and uploading images for the chat. Images are shrunk and re-encoded in the browser
// first (smaller uploads, EXIF metadata such as GPS stripped), then stored in the server's memory.
import { getClientId, getToken, getPassword } from "../session.js";

const MAX_EDGE = 1600;             // longest side after resizing, in pixels
const TARGET_BYTES = 2.5 * 1024 * 1024;
const HARD_LIMIT = 3 * 1024 * 1024; // must match the server (MAX_IMAGE_BYTES)

function encode(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Returns { blob, w, h } ready to upload, or throws an Error with a message for the user.
export async function prepareImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Image illisible");
  }
  try {
    // Animated GIFs would lose their animation when redrawn: send them untouched if small enough.
    if (file.type === "image/gif") {
      if (file.size > HARD_LIMIT) throw new Error("GIF trop lourd (3 Mo maximum)");
      return { blob: file, w: bitmap.width, h: bitmap.height };
    }
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      // WebP keeps transparency and is compact; fall back to JPEG where it cannot be encoded.
      const blob = await encode(canvas, "image/webp", 0.82 - attempt * 0.1)
        .then(result => (result?.type === "image/webp" ? result : encode(canvas, "image/jpeg", 0.8 - attempt * 0.1)));
      if (blob && blob.size <= TARGET_BYTES) return { blob, w, h };
      scale *= 0.75;
    }
    throw new Error("Image trop lourde, même réduite");
  } finally {
    bitmap.close();
  }
}

// Uploads the blob and returns the image id to attach to the next message.
export async function uploadImage(blob) {
  const headers = { "X-Client-Id": getClientId(), "X-Token": getToken() };
  if (getPassword()) headers["X-Room-Password"] = getPassword();
  const response = await fetch("/upload", { method: "POST", body: blob, headers });
  if (!response.ok) {
    if (response.status === 413) throw new Error("Image trop lourde (3 Mo maximum)");
    if (response.status === 429) throw new Error("Trop d'images d'un coup, patientez un instant");
    throw new Error((await response.text()).slice(0, 120) || "Envoi de l'image impossible");
  }
  return (await response.json()).id;
}

// Emoji picker data and rendering of single-emoji messages (animated Noto emoji).
import { escapeHtml } from "./util.js";

export const emojiData = {
  smileys:["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","🥸","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🫡","🤭","🫢","🫣","🤫","🫠","🫥","😶","😶‍🌫️","😐","😑","🫤","🙄","😬","😮","😯","😲","🥱","😴","🤤","😪","😵","😵‍💫","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","💀","☠️","👻","👽","🤖","💩"],
  hearts:["❤️","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","💔","❤️‍🔥","❤️‍🩹","💕","💞","💓","💗","💖","💘","💝","💟","❣️","💋","💐","🌹","🌷","🌸","🌺","🌻","🌼","🪷","🥰","😍","😘"],
  gestures:["👍","👎","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👏","🙌","🫶","🙏","💪","🦾","👀","👁️","🫵","☝️","👇","👉","👈","👊","✊","🤛","🤜","🤝","🫂","💅","✍️"],
  animals:["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐻‍❄️","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪲","🐞","🦋","🐌","🐛","🪱","🐜","🕷️","🦂","🐢","🐍","🦎","🐙","🦑","🦀","🦞","🐠","🐟","🐡","🦈","🐬","🐳","🐋","🦭","🐊","🐆","🐅","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🦒","🦘","🦬","🐄","🐏","🐐","🦌","🐕","🐈","🐓","🦃","🦚","🦜","🦢","🦩","🐇","🦝","🦨","🦡","🦦","🦥","🐁","🐿️","🦔"],
  food:["🍏","🍎","🍐","🍊","🍋","🍋‍🟩","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🫓","🥪","🌮","🌯","🫔","🥗","🥘","🫕","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","☕","🍵","🧃","🥤","🧋"],
  activities:["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤸","⛹️","🤺","🤾","🏌️","🏇","🧘","🏄","🏊","🚣","🧗","🚴","🚵","🏆","🥇","🥈","🥉","🏅","🎮","🕹️","🎲","♟️","🧩","🎯","🎳","🎨","🎭","🎤","🎧","🎸","🎹","🥁","🎷","🎺","🎻"],
  travel:["🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍️","🛵","🚲","🛴","🚨","🚔","🚍","🚘","🚖","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩️","💺","🚁","🚀","🛸","⛵","🚤","🛥️","🛳️","⛴️","🚢","⚓","⛽","🚧","🚦","🗺️","🗿","🗽","🗼","🏰","🏯","🏟️","🎡","🎢","🎠","⛲","⛺","🏠","🏡","🏢","🏥","🏦","🏨","🏪","🏫","🏭","🏝️","🏖️","🏜️","🏔️","🌋","⛰️","🌅","🌄","🌌","🌃"],
  objects:["💻","🖥️","⌨️","🖱️","🖨️","📱","☎️","📞","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭","⏱️","⏰","⌚","📷","📸","📹","🎥","📽️","🎞️","🔍","🔎","💡","🔦","🏮","📔","📕","📖","📗","📘","📙","📚","📓","📒","📃","📜","📄","📰","🗞️","📑","🔖","🏷️","💰","🪙","💳","🧾","✉️","📧","📨","📩","📤","📥","📦","📫","📪","📬","📭","📮","✏️","✒️","🖋️","🖊️","🖌️","🖍️","📝","💼","📁","📂","🗂️","📅","📆","🗒️","🗓️","📇","📈","📉","📊","📋","📌","📍","📎","🖇️","📏","📐","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔏","🔐","🔑","🗝️","🔨","🪓","⛏️","⚒️","🛠️","🗡️","⚙️","🧱","⛓️","🧲","🧪","🧬","🔬","🔭","📡","💉","🩹","🩺","🚪","🪑","🚽","🚿","🛁","🧹","🧺","🧻","🪣","🧼","🪥","🧽","🧯","🛒","🎁","🎈","🎀","🎊","🎉","🪄","🪅","🪩","💾","💿","📀"],
  symbols:["✨","⭐","🌟","💫","⚡","🔥","💥","❄️","☀️","🌙","🌈","☁️","🌧️","⛈️","🌊","💧","💦","☔","☂️","♻️","✅","❌","❓","❗","‼️","⁉️","⭕","🚫","⛔","⚠️","🔞","📵","🔇","🔈","🔉","🔊","🔔","🔕","💬","💭","🗯️","♠️","♥️","♦️","♣️","🃏","🀄","🎴","🔴","🟠","🟡","🟢","🔵","🟣","🟤","⚫","⚪","🟥","🟧","🟨","🟩","🟦","🟪","⬛","⬜","◼️","◻️","🔶","🔷","🔸","🔹","🔺","🔻","💠","🔘","🔳","🔲"]
};

export const emojiIcons = {
  smileys:"😀", hearts:"❤️", gestures:"👍", animals:"🐶", food:"🍕",
  activities:"🎮", travel:"🚗", objects:"💻", symbols:"✨"
};

// Les assets animés sont servis par Google Fonts ; sans réseau, on revient à l'emoji Unicode.
const NOTO_ANIMATED_BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function getSingleEmojiGrapheme(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  const graphemes = Array.from(segmenter.segment(value), part => part.segment);
  if (graphemes.length !== 1) return null;
  if (!/\p{Extended_Pictographic}/u.test(graphemes[0])) return null;
  return graphemes[0];
}

function notoAnimatedUrl(emoji) {
  const codepoints = Array.from(emoji).map(char => char.codePointAt(0).toString(16).toLowerCase()).join("_");
  return `${NOTO_ANIMATED_BASE}/${codepoints}/512.gif`;
}

// Animated images come from Google's servers, so they are opt-in: by default a lone emoji
// is shown large from the system font and nothing is requested from the Internet.
// The caller wires the image "error" event (see bindEmojiFallback) instead of an inline handler.
export function renderMessageText(text, animated = false) {
  const emoji = getSingleEmojiGrapheme(text);
  if (!emoji) return escapeHtml(text);
  const safeEmoji = escapeHtml(emoji);
  if (!animated) return `<span class="noto-emoji-fallback" aria-label="${safeEmoji}">${safeEmoji}</span>`;
  return `<span class="noto-emoji-wrapper" aria-label="${safeEmoji}">
      <img class="noto-animated-emoji" src="${notoAnimatedUrl(emoji)}" alt="${safeEmoji}" draggable="false">
      <span class="noto-emoji-fallback" style="display:none">${safeEmoji}</span>
    </span>`;
}

export function bindEmojiFallback(root) {
  root.querySelectorAll(".noto-animated-emoji").forEach(img => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      img.nextElementSibling.style.display = "inline-block";
    }, { once: true });
  });
}

export const isAnimatedEmojiOnly = text => Boolean(getSingleEmojiGrapheme(text));

// Entry point: wires the chat modules, the settings window and the media modules together.
import { showToast } from "./util.js";
import { on, getClientId, getSocket, isReady } from "./session.js";
import { initMedia, mediaDebug } from "./media/index.js";
import { initSettings } from "./settings.js";
import { setConnection } from "./chat/connection.js";
import { renderUsers, getUsers, initUsers } from "./chat/users.js";
import { initMessages, addMessage, renderMessages, applyReactions, isAnimatedEmoji, setAnimatedEmoji } from "./chat/messages.js";
import { initComposer } from "./chat/composer.js";
import { initJoin, isJoined, requirePassword } from "./chat/join.js";
import { initLayout } from "./chat/layout.js";
import { onTyping, clearTyper, pruneTypers } from "./chat/typing.js";
import { initNotifications, notifyMessage, trackVoice, resetVoiceTracking } from "./chat/notifications.js";

// Server events. "state" is the full snapshot (users + history) sent on join;
// "users", "message" and "reactions" are the deltas that follow.
function onUsers(data) {
  setConnection("Connecté", "ok");
  renderUsers(data.users || [], data.voice_users || []);
  pruneTypers(new Set((data.users || []).map(user => user.id)));
  trackVoice(data.voice_users || []);
  if (data.messages) renderMessages(data.messages);
}
on("state", resetVoiceTracking); // the full snapshot is not a change: no sounds for it
on("state", onUsers);
on("users", onUsers);
on("message", data => {
  clearTyper(data.message.id);
  addMessage(data.message);
  notifyMessage(data.message);
});
on("typing", onTyping);
on("disconnect", resetVoiceTracking);
on("reactions", data => applyReactions(data.msg_id, data.reactions, true));
on("error", data => showToast(data.error));
on("status", text => setConnection(text, "warn"));
on("needpassword", requirePassword);

initUsers();
initMessages();
initNotifications();
initComposer();
initJoin();
initLayout();
initSettings({ isJoined, animatedEmoji: isAnimatedEmoji(), onAnimatedEmoji: setAnimatedEmoji });
initMedia();

// Read-only hook used by the end-to-end browser test.
window.__lanChat = {
  get ready() { return isReady(); },
  get clientId() { return getClientId(); },
  get socket() { return getSocket(); },
  get users() { return getUsers(); },
  get media() { return mediaDebug(); }
};

console.info("Noto Animated Emoji © Google LLC — CC BY 4.0 — https://googlefonts.github.io/noto-emoji-animation/");

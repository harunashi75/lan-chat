// Identity, WebSocket transport and presence. Chat (app.js) and media (media.js) both
// build on this module and never touch the socket directly.
const listeners = new Map();

export function on(type, handler) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(handler);
}

async function emit(type, data) {
  for (const handler of listeners.get(type) || []) await handler(data);
}

const fire = (type, data) => emit(type, data).catch(error => console.error(type, error));

// crypto.randomUUID is only available in secure contexts; plain http://192.168.x.x is not.
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function stored(key) {
  let value = sessionStorage.getItem(key);
  if (!value) { value = newId(); sessionStorage.setItem(key, value); }
  return value;
}

let clientId = stored("lan_chat_client_id");
let token = stored("lan_chat_token");
let password = sessionStorage.getItem("lan_chat_password") || "";
let name = localStorage.getItem("lan_chat_username") || "";
const presence = { in_voice: false, sharing_screen: false, receive_screens: true };

let socket = null;
let ready = false;
let reconnectTimer = null;
let reconnectDelay = 500;
let rtcConfig = { iceServers: [] };
let videoBudget = 40000000;

export const getClientId = () => clientId;
export const getName = () => name;
export const getPassword = () => password;
export const getToken = () => token;
export const isReady = () => ready;
export const getRtcConfig = () => rtcConfig;
export const getVideoBudget = () => videoBudget;
export const getSocket = () => socket;

export function setName(value) {
  name = value;
  localStorage.setItem("lan_chat_username", name);
  updatePresence();
}

export function setPassword(value) {
  password = value;
  if (value) sessionStorage.setItem("lan_chat_password", value);
  else sessionStorage.removeItem("lan_chat_password");
}

export function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

export function updatePresence(patch = {}) {
  Object.assign(presence, patch);
  send({ type: "presence", name, ...presence });
}

function scheduleReconnect() {
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 10000);
}

export async function connect() {
  if (socket) return;
  clearTimeout(reconnectTimer);
  try {
    const response = await fetch("/config", { headers: { "X-Room-Password": password } });
    if (!response.ok) throw new Error("Configuration indisponible");
    const config = await response.json();
    rtcConfig = { iceServers: config.iceServers || [] };
    videoBudget = config.videoBudget || videoBudget;
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("client", clientId);
    url.searchParams.set("token", token);
    if (password) url.searchParams.set("password", password);
    const ws = new WebSocket(url);
    socket = ws;
    let incoming = Promise.resolve();
    ws.onopen = () => {
      reconnectDelay = 500;
      ready = true;
      updatePresence();
    };
    ws.onmessage = event => {
      // Handlers run one message at a time, in arrival order.
      incoming = incoming.then(async () => {
        const data = JSON.parse(event.data);
        await emit(data.type, data);
      }).catch(error => console.error("Signalisation", error));
    };
    ws.onclose = event => {
      if (socket !== ws) return;
      socket = null;
      ready = false;
      if (event.code === 4004) {
        fire("status", "Mot de passe requis");
        fire("needpassword");
        return;
      }
      if (event.code === 4001 || event.code === 4003) {
        // Identity taken over by another tab, or token rejected: start a fresh identity.
        clientId = newId();
        token = newId();
        sessionStorage.setItem("lan_chat_client_id", clientId);
        sessionStorage.setItem("lan_chat_token", token);
      }
      fire("status", "Reconnexion…");
      fire("disconnect");
      scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  } catch (error) {
    console.error(error);
    fire("status", "Serveur indisponible · reconnexion…");
    scheduleReconnect();
  }
}

export function close() {
  clearTimeout(reconnectTimer);
  if (socket) { socket.onclose = null; socket.close(); }
}

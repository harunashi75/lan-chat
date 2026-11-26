// Starts (or reuses) the LAN Chat server for "host" mode, and stops it on exit.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let serverProcess = null;

// Packaged app: the frozen server shipped in resources/server. Development: .venv + server.py.
function serverCommand() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'lan-chat-server.exe' : 'lan-chat-server';
    const command = path.join(process.resourcesPath, 'server', exe);
    if (!fs.existsSync(command)) throw new Error('Serveur intégré introuvable : réinstallez LAN Chat.');
    return { command, args: [], cwd: path.dirname(command) };
  }
  const python = process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  if (!fs.existsSync(python)) {
    throw new Error('Lancez start.sh (Linux/macOS) ou start.bat (Windows) une première fois pour préparer Python.');
  }
  return { command: python, args: [path.join(ROOT, 'server.py')], cwd: ROOT };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchConfig(address, timeout) {
  return fetch(`${address}/config`, { signal: AbortSignal.timeout(timeout) });
}

// Returns the server address, or null when nothing listens on it yet.
async function reuseRunningServer(address) {
  try {
    const response = await fetchConfig(address, 700);
    if (response.ok && (await response.json()).mediaTopology === 'mesh') return address;
  } catch {
    return null; // nothing there: we will start our own
  }
  throw new Error('Ce port est occupé par un autre service.');
}

async function startServer() {
  const { command, args, cwd } = serverCommand();
  const address = `http://localhost:${process.env.LAN_CHAT_PORT || '8765'}`;
  const running = await reuseRunningServer(address);
  if (running) return running;

  serverProcess = spawn(command, args, { stdio: 'inherit', cwd });
  let failure;
  serverProcess.once('error', error => { failure = error; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure || serverProcess.exitCode !== null) throw failure || new Error('Le serveur s’est arrêté.');
    try {
      if ((await fetchConfig(address, 500)).ok) return address;
    } catch { /* not ready yet */ }
    await sleep(200);
  }
  throw new Error('Le serveur ne répond pas.');
}

function stopServer() {
  if (serverProcess) serverProcess.kill();
}

module.exports = { startServer, stopServer };

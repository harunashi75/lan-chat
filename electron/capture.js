// Screen capture in Electron: permissions, the system picker, and the fallback picker window.
const { BrowserWindow, ipcMain, session, desktopCapturer } = require('electron');
const path = require('node:path');

const ALLOWED_PERMISSIONS = ['media', 'display-capture', 'fullscreen'];
const pendingPickers = new Map(); // picker webContents id -> { sources, audioRequested, finish, picker }

// Shows our own picker window listing screens and windows. Resolves with the choice, or null.
function chooseSource(parent, sources, audioRequested) {
  return new Promise(resolve => {
    const picker = new BrowserWindow({
      parent, modal: true, width: 850, height: 620, title: 'Choisir un écran ou une fenêtre', autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'desktop-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    const pickerId = picker.webContents.id;
    const finish = value => {
      if (!pendingPickers.has(pickerId)) return;
      pendingPickers.delete(pickerId);
      resolve(value);
    };
    pendingPickers.set(pickerId, { sources, audioRequested, finish, picker });
    picker.on('closed', () => finish(null));
    picker.loadFile(path.join(__dirname, '..', 'capture-picker.html'));
  });
}

async function handleDisplayMediaRequest(request, callback, { getMainWindow, isTrusted }) {
  if (!isTrusted(request.securityOrigin)) { callback({}); return; }
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false
    });
    if (!sources.length) { callback({}); return; }
    const selection = await chooseSource(getMainWindow(), sources, request.audioRequested);
    if (!selection) { callback({}); return; }
    const options = { video: selection.source };
    // Electron's documented desktop audio loopback is supported on Windows.
    // Other platforms use the system picker when it supports audio capture.
    if (selection.audio && request.audioRequested && process.platform === 'win32') options.audio = 'loopback';
    callback(options);
  } catch (error) {
    console.error('Capture', error);
    callback({});
  }
}

// Only the main window, on the trusted origin, may use the microphone and screen capture.
function installCapture({ getMainWindow, getTrustedOrigin }) {
  const isTrusted = value => {
    try { return new URL(value).origin === getTrustedOrigin(); } catch { return false; }
  };
  const allowed = (contents, permission, origin) =>
    contents === getMainWindow()?.webContents && isTrusted(origin) && ALLOWED_PERMISSIONS.includes(permission);

  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((contents, permission, origin) => allowed(contents, permission, origin));
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed(contents, permission, details.requestingUrl || contents.getURL()));
  });
  ses.setDisplayMediaRequestHandler(
    (request, callback) => handleDisplayMediaRequest(request, callback, { getMainWindow, isTrusted }),
    { useSystemPicker: true });

  ipcMain.handle('capture-sources', event => {
    const pending = pendingPickers.get(event.sender.id);
    if (!pending) return null;
    return {
      audioAvailable: pending.audioRequested && process.platform === 'win32',
      sources: pending.sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }))
    };
  });
  ipcMain.handle('capture-select', (event, selection) => {
    const pending = pendingPickers.get(event.sender.id);
    if (!pending) return;
    const source = pending.sources.find(item => item.id === selection?.id);
    pending.finish(source ? { source, audio: selection.audio === true } : null);
    pending.picker.close();
  });
}

function closePendingPickers() {
  for (const pending of pendingPickers.values()) pending.picker.close();
}

module.exports = { installCapture, closePendingPickers };

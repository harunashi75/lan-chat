// Freezes server.py (+ index.html and static/) into build/server with PyInstaller.
// --onedir (not --onefile): a single process, so Electron can stop it reliably on every OS.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const sep = process.platform === 'win32' ? ';' : ':';
const args = ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'lan-chat-server',
  '--distpath', path.join(root, 'build'), '--workpath', path.join(root, 'build', 'pyinstaller'),
  '--specpath', path.join(root, 'build', 'pyinstaller'),
  '--add-data', `${path.join(root, 'index.html')}${sep}.`,
  '--add-data', `${path.join(root, 'static')}${sep}static`,
  path.join(root, 'server.py')];
const result = spawnSync(python, args, { stdio: 'inherit', cwd: root });
if (result.error || result.status !== 0) {
  console.error('PyInstaller a échoué (pip install -r requirements-dev.txt dans .venv ?).');
  process.exit(result.status || 1);
}

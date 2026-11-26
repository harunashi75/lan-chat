// Runs the project's virtualenv Python on any OS: node scripts/venv-python.cjs -m unittest ...
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const python = path.join(__dirname, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error('Environnement Python absent : lancez start.sh / start.bat une première fois.');
  process.exit(1);
}
process.exit(result.status ?? 1);

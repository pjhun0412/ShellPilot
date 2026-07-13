import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const nodeBin = path.join(root, 'node_modules', '.bin');
const cargoBin = path.join(homedir(), '.cargo', 'bin');
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const separator = process.platform === 'win32' ? ';' : ':';
const pathParts = [nodeBin, cargoBin, process.env[pathKey]].filter(Boolean);
const env = {
  ...process.env,
  [pathKey]: pathParts.join(separator),
};
const tauriExecutable = path.join(nodeBin, process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
const command = existsSync(tauriExecutable) ? tauriExecutable : 'tauri';
const result = spawnSync(command, process.argv.slice(2), {
  cwd: root,
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

import fs from 'fs';
import path from 'path';

const STATE_DIR = path.join(process.cwd(), 'state');
const MAP_PATH = path.join(STATE_DIR, 'notarizations.json');

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function loadNotarizationMap() {
  ensureDir();
  if (!fs.existsSync(MAP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function saveNotarizationMap(map) {
  ensureDir();
  const tmp = MAP_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, MAP_PATH); // atomic-ish
}
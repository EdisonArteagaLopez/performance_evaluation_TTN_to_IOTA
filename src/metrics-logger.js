import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const CSV_PATH = path.join(LOG_DIR, 'oracle_metrics.csv');
const JSONL_PATH = path.join(LOG_DIR, 'oracle_events.jsonl');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function ensureCsvHeader() {
  ensureDir();
  if (fs.existsSync(CSV_PATH)) return;
  const header = [
    'ts_iso','device_id','op','digest','notarization_id',
    'ms_total','ms_iota','lat_ttn_to_oracle','lat_e2e','sha25610',
    'gas_comp','gas_storage','gas_rebate','gas_nonref',
    'rss','heapUsed','cpuUser','cpuSystem'
  ].join(',') + '\n';
  fs.writeFileSync(CSV_PATH, header);
}

export function appendMetricsCsv(row) {
  ensureCsvHeader();
  fs.appendFileSync(CSV_PATH, row + '\n');
}

export function appendEventJsonl(obj) {
  ensureDir();
  fs.appendFileSync(JSONL_PATH, JSON.stringify(obj) + '\n');
}
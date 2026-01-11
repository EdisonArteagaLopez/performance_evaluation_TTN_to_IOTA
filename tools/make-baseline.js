// src/make-baseline.js
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');

// Inputs (generados por analyze-logs.js)
const IN_BY_DEVICE_OP = path.join(LOG_DIR, 'summary_by_device_op.csv');
const IN_OVERALL_OP   = path.join(LOG_DIR, 'summary_overall_by_op.csv');

// Optional meta (si existe)
const META_TXT = path.join(LOG_DIR, 'experiment_meta.txt');

// Outputs
const OUT_BASELINE_JSON = path.join(LOG_DIR, 'baseline_phase5_laptop.json');
const OUT_BASELINE_CSV  = path.join(LOG_DIR, 'baseline_phase5_laptop.csv');

function die(msg) {
  console.error('❌', msg);
  process.exit(1);
}

function existsOrDie(p) {
  if (!fs.existsSync(p)) die(`No existe ${p}. Corre primero: npm run analyze`);
}

function parseCsvLine(line) {
  // CSV simple con comillas dobles
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }

    cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8').trim();
  if (!txt) die(`Archivo vacío: ${filePath}`);
  const lines = txt.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = cols[j] ?? '';
    rows.push(obj);
  }
  return rows;
}

function toNum(x) {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pickRow(rows, predicate, label) {
  const found = rows.filter(predicate);
  if (found.length === 0) die(`No encontré fila para: ${label}`);
  if (found.length > 1) {
    // Si hay duplicados por cualquier razón, prioriza el primero
    console.warn(`⚠️ Hay ${found.length} filas para ${label}. Usaré la primera.`);
  }
  return found[0];
}

function parseMetaTxt(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const txt = fs.readFileSync(filePath, 'utf8');
  const meta = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_\-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    meta[m[1]] = m[2];
  }
  return meta;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('\n') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeBaselineCsv(outPath, baseline) {
  // Tabla compacta y “paper-friendly”
  const header = [
    'scope', 'device_id', 'op', 'n',
    'ms_iota_p50', 'ms_iota_p95',
    'lat_end_to_end_ms_p50', 'lat_end_to_end_ms_p95',
    'lat_ttn_to_oracle_ms_p50', 'lat_ttn_to_oracle_ms_p95',
    'gas_comp_mean', 'gas_storage_mean', 'gas_nonref_mean',
    'rss_bytes_mean', 'heap_used_bytes_mean',
    'cpu_user_ms_mean', 'cpu_system_ms_mean'
  ];

  const rows = [];

  function add(scope, device_id, op, obj) {
    rows.push({
      scope,
      device_id,
      op,
      n: obj.n ?? '',
      ms_iota_p50: obj.ms_iota_p50 ?? '',
      ms_iota_p95: obj.ms_iota_p95 ?? '',
      lat_end_to_end_ms_p50: obj.lat_end_to_end_ms_p50 ?? '',
      lat_end_to_end_ms_p95: obj.lat_end_to_end_ms_p95 ?? '',
      lat_ttn_to_oracle_ms_p50: obj.lat_ttn_to_oracle_ms_p50 ?? '',
      lat_ttn_to_oracle_ms_p95: obj.lat_ttn_to_oracle_ms_p95 ?? '',
      gas_comp_mean: obj.gas_comp_mean ?? '',
      gas_storage_mean: obj.gas_storage_mean ?? '',
      gas_nonref_mean: obj.gas_nonref_mean ?? '',
      rss_bytes_mean: obj.rss_bytes_mean ?? '',
      heap_used_bytes_mean: obj.heap_used_bytes_mean ?? '',
      cpu_user_ms_mean: obj.cpu_user_ms_mean ?? '',
      cpu_system_ms_mean: obj.cpu_system_ms_mean ?? '',
    });
  }

  add('overall', 'ALL', 'update', baseline.overall.update);
  add('device', 'nodo1', 'update', baseline.by_device.nodo1.update);
  add('device', 'nodo2', 'update', baseline.by_device.nodo2.update);

  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
}

function main() {
  existsOrDie(IN_BY_DEVICE_OP);
  existsOrDie(IN_OVERALL_OP);

  const byDeviceOp = readCsv(IN_BY_DEVICE_OP);
  const overallOp  = readCsv(IN_OVERALL_OP);

  // Baseline principal = UPDATE (create se reporta aparte si quieres)
  const overallUpdate = pickRow(
    overallOp,
    (r) => (r.op ?? '').trim() === 'update',
    'overall update'
  );

  const nodo1Update = pickRow(
    byDeviceOp,
    (r) => (r.device_id ?? '').trim() === 'nodo1' && (r.op ?? '').trim() === 'update',
    'nodo1 update'
  );

  const nodo2Update = pickRow(
    byDeviceOp,
    (r) => (r.device_id ?? '').trim() === 'nodo2' && (r.op ?? '').trim() === 'update',
    'nodo2 update'
  );

  // Compacta a un objeto “estable”
  const meta = parseMetaTxt(META_TXT);

  const baseline = {
    phase: 'F5-baseline',
    platform: 'laptop',
    generated_at_iso: new Date().toISOString(),
    inputs: {
      summary_by_device_op_csv: path.relative(process.cwd(), IN_BY_DEVICE_OP),
      summary_overall_by_op_csv: path.relative(process.cwd(), IN_OVERALL_OP),
      experiment_meta_txt: fs.existsSync(META_TXT) ? path.relative(process.cwd(), META_TXT) : null,
    },
    experiment_meta: meta,
    overall: {
      update: overallUpdate,
    },
    by_device: {
      nodo1: { update: nodo1Update },
      nodo2: { update: nodo2Update },
    },
    // Campos clave “paper-ready” (redundancia útil)
    kpis: {
      overall_update: {
        n: toNum(overallUpdate.n),
        ms_iota_p50: toNum(overallUpdate.ms_iota_p50),
        ms_iota_p95: toNum(overallUpdate.ms_iota_p95),
        lat_end_to_end_ms_p50: toNum(overallUpdate.lat_end_to_end_ms_p50),
        lat_end_to_end_ms_p95: toNum(overallUpdate.lat_end_to_end_ms_p95),
        lat_ttn_to_oracle_ms_p50: toNum(overallUpdate.lat_ttn_to_oracle_ms_p50),
        lat_ttn_to_oracle_ms_p95: toNum(overallUpdate.lat_ttn_to_oracle_ms_p95),
        gas_comp_mean: toNum(overallUpdate.gas_comp_mean),
        gas_storage_mean: toNum(overallUpdate.gas_storage_mean),
        gas_nonref_mean: toNum(overallUpdate.gas_nonref_mean),
        rss_bytes_mean: toNum(overallUpdate.rss_bytes_mean),
        heap_used_bytes_mean: toNum(overallUpdate.heap_used_bytes_mean),
        cpu_user_ms_mean: toNum(overallUpdate.cpu_user_ms_mean),
        cpu_system_ms_mean: toNum(overallUpdate.cpu_system_ms_mean),
      },
    },
  };

  fs.writeFileSync(OUT_BASELINE_JSON, JSON.stringify(baseline, null, 2), 'utf8');
  writeBaselineCsv(OUT_BASELINE_CSV, baseline);

  console.log('✅ Baseline generada:');
  console.log(' -', path.relative(process.cwd(), OUT_BASELINE_JSON));
  console.log(' -', path.relative(process.cwd(), OUT_BASELINE_CSV));
  console.log('\n📌 KPI clave (overall update):');
  console.log(' - n =', baseline.kpis.overall_update.n);
  console.log(' - p95 end-to-end (ms) =', baseline.kpis.overall_update.lat_end_to_end_ms_p95);
  console.log(' - p95 iota (ms) =', baseline.kpis.overall_update.ms_iota_p95);
}

main();
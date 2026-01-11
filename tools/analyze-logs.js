// src/analyze-logs.js
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const IN_CSV = path.join(LOG_DIR, 'notarize_metrics.csv');
const OUT_BY_DEVICE_OP = path.join(LOG_DIR, 'summary_by_device_op.csv');
const OUT_OVERALL_OP = path.join(LOG_DIR, 'summary_overall_by_op.csv');

function die(msg) {
  console.error('❌', msg);
  process.exit(1);
}

function toNum(x) {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseCsvLine(line) {
  // CSV simple con escape de comillas dobles; suficiente para nuestros datos.
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

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) die(`No existe ${filePath}. Ejecuta primero el oracle para generar logs.`);
  const txt = fs.readFileSync(filePath, 'utf8').trim();
  if (!txt) die(`El archivo ${filePath} está vacío.`);

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

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function stats(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (!v.length) {
    return { count: 0, mean: null, min: null, max: null, p50: null, p95: null };
  }
  const sorted = [...v].sort((a, b) => a - b);
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    count: v.length,
    mean: sum / v.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function fmt(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  // 3 decimales para ms y cpu; para bytes/gas igual queda bien
  return String(Math.round(x * 1000) / 1000);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeSummaryCsv(filePath, rows) {
  if (!rows.length) die('No hay filas para escribir en resumen.');
  const header = Object.keys(rows[0]);
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k] ?? '')).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

const METRICS = [
  'ms_total',
  'ms_iota',
  'lat_ttn_to_oracle_ms',
  'lat_end_to_end_ms',
  'gas_comp',
  'gas_storage',
  'gas_rebate',
  'gas_nonref',
  'cpu_user_ms',
  'cpu_system_ms',
  'rss_bytes',
  'heap_used_bytes',
];

function groupKey(row, keys) {
  return keys.map((k) => row[k] ?? '').join('||');
}

function buildSummary(rows, groupKeys) {
  const groups = new Map();

  for (const r of rows) {
    const k = groupKey(r, groupKeys);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const out = [];
  for (const [k, groupRows] of groups.entries()) {
    const base = {};
    const parts = k.split('||');
    groupKeys.forEach((gk, i) => (base[gk] = parts[i]));

    // count total de filas (eventos)
    base.n = String(groupRows.length);

    for (const m of METRICS) {
      const vals = groupRows.map((x) => toNum(x[m]));
      const s = stats(vals);

      base[`${m}_count`] = String(s.count);
      base[`${m}_mean`] = fmt(s.mean);
      base[`${m}_p50`] = fmt(s.p50);
      base[`${m}_p95`] = fmt(s.p95);
      base[`${m}_min`] = fmt(s.min);
      base[`${m}_max`] = fmt(s.max);
    }

    out.push(base);
  }

  // Orden: device_id asc, op asc
  out.sort((a, b) => {
    for (const k of groupKeys) {
      const av = a[k] ?? '';
      const bv = b[k] ?? '';
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });

  return out;
}

function main() {
  const rows = readCsv(IN_CSV);

  // Normaliza algunos campos claves (por si acaso)
  for (const r of rows) {
    r.device_id = (r.device_id ?? '').trim();
    r.op = (r.op ?? '').trim();
  }

  const byDeviceOp = buildSummary(rows, ['device_id', 'op']);
  writeSummaryCsv(OUT_BY_DEVICE_OP, byDeviceOp);

  const overallByOp = buildSummary(rows, ['op']);
  writeSummaryCsv(OUT_OVERALL_OP, overallByOp);

  console.log('✅ Summary generado:');
  console.log(' -', OUT_BY_DEVICE_OP);
  console.log(' -', OUT_OVERALL_OP);

  // Extra: muestra top 5 peores p95 end-to-end por device/op
  const ranked = [...byDeviceOp]
    .map((r) => ({
      device_id: r.device_id,
      op: r.op,
      p95_e2e: toNum(r.lat_end_to_end_ms_p95),
      p95_iota: toNum(r.ms_iota_p95),
      n: toNum(r.n),
    }))
    .filter((x) => x.p95_e2e !== null)
    .sort((a, b) => b.p95_e2e - a.p95_e2e)
    .slice(0, 5);

  console.log('\n📌 Top 5 (p95 lat_end_to_end_ms) por device/op:');
  for (const x of ranked) {
    console.log(
      ` - ${x.device_id} ${x.op} | p95_e2e=${fmt(x.p95_e2e)} ms | p95_iota=${fmt(x.p95_iota)} ms | n=${x.n}`
    );
  }
}

main();
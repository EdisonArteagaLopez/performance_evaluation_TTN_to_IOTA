// src/mainnet-notarize.js
import 'dotenv/config';
import mqtt from 'mqtt';
import crypto from 'crypto';
import stringify from 'json-stable-stringify';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { monitorEventLoopDelay } from 'perf_hooks';

import { IotaClient } from '@iota/iota-sdk/client';
import * as notar from '@iota/notarization/node/index.js';

import { getSignerFromIotaCli } from './signer-from-cli.js';
import { Ed25519KeypairSigner } from '@iota/iota-interaction-ts/node/test_utils/index.js';

// ---- ENV ----
const {
  // TTN
  TTN_HOST,
  TTN_REGION = 'eu1',
  TTN_DOMAIN = 'cloud.thethings.network',
  TTN_APP_UID,
  TTN_APP_ID,
  TTN_MQTT_USERNAME,
  TTN_API_KEY,
  TTN_DEVICE_ID = '+',

  // IOTA
  IOTA_RPC = 'https://api.mainnet.iota.cafe',

  // oracle behavior
  ORACLE_TAG = 'TTN-ORACLE',
  NOTARIZE_EVERY_N = '1',
} = process.env;

// ---- Device aliasing (experimental IDs) ----
// Ajusta a tu experimento para evitar confusiones ("nodo-2" vs "nodo2")
const DEVICE_ALIAS = {
  'nodo-2': 'nodo1',
  'nodo2': 'nodo2',
};

const host = TTN_HOST ? TTN_HOST : `${TTN_REGION}.${TTN_DOMAIN}`;
const appUid = TTN_APP_UID || TTN_APP_ID;
const mqttUsername = TTN_MQTT_USERNAME || appUid;

if (!host) throw new Error('Missing TTN_HOST or TTN_REGION/TTN_DOMAIN');
if (!appUid) throw new Error('Missing TTN_APP_UID or TTN_APP_ID');
if (!TTN_API_KEY) throw new Error('Missing TTN_API_KEY');
if (!IOTA_RPC) throw new Error('Missing IOTA_RPC');

const N = Math.max(1, Number(NOTARIZE_EVERY_N) || 1);
const topic = `v3/${appUid}/devices/${TTN_DEVICE_ID}/up`;

// ---- persistence paths ----
const STATE_DIR = path.join(process.cwd(), 'state');
const LOG_DIR = path.join(process.cwd(), 'logs');
const MAP_PATH = path.join(STATE_DIR, 'notarizations.json');

const METRICS_CSV = path.join(LOG_DIR, 'notarize_metrics.csv');
const EVENTS_JSONL = path.join(LOG_DIR, 'notarize_events.jsonl');

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

function loadMap() {
  try {
    return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function saveMap(map) {
  const tmp = MAP_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, MAP_PATH);
}

// ---- Event loop monitor ----
const eld = monitorEventLoopDelay({ resolution: 20 });
eld.enable();
function eventLoopStatsAndReset() {
  const p50 = Number(eld.percentile(50)) / 1e6;
  const p95 = Number(eld.percentile(95)) / 1e6;
  const max = Number(eld.max) / 1e6;
  eld.reset();
  return { event_loop_p50_ms: p50, event_loop_p95_ms: p95, event_loop_max_ms: max };
}

// ---- OS / Raspberry helpers ----
function readTextIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
}
function getCpuTempC() {
  const raw = readTextIfExists('/sys/class/thermal/thermal_zone0/temp');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1000 ? n / 1000 : n;
}
function getCpuFreqKHz() {
  const raw =
    readTextIfExists('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') ??
    readTextIfExists('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_cur_freq');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function getLoadAvg() {
  const [l1, l5, l15] = os.loadavg();
  return { loadavg_1m: l1, loadavg_5m: l5, loadavg_15m: l15 };
}

// ---- counters (24h) ----
const COUNTERS = {
  mqtt_reconnects: 0,
  mqtt_disconnects: 0,
  iota_failures: 0,
  busy_drops: 0,
  skipped: 0,
  notarized: 0,
  received: 0,
};

function ensureCsvHeader() {
  if (!fs.existsSync(METRICS_CSV)) {
    fs.writeFileSync(
      METRICS_CSV,
      [
        'ts_iso',

        // identificación
        'device_id',        // alias: nodo1, nodo2
        'device_id_raw',    // TTN real: nodo-2, nodo2

        // operación en IOTA
        'op',               // create | update
        'digest',
        'notarization_id',
        'sha25610',

        // tiempos base
        'ms_total',               // handler total
        'ms_iota',                // submit->done TX
        'lat_ttn_to_oracle_ms',   // received_at -> llegada local oracle
        'lat_end_to_end_ms',      // received_at -> done TX

        // radio / payload
        'rssi',
        'snr',
        'f_port',

        // gas / costos
        'gas_comp',
        'gas_storage',
        'gas_rebate',
        'gas_nonref',

        // consumo computacional
        'cpu_user_ms',
        'cpu_system_ms',
        'rss_bytes',
        'heap_used_bytes',

        // ---- NUEVO: breakdown interno ----
        'ms_parse_json',
        'ms_hash',
        'ms_build_and_execute',

        // ---- NUEVO: tamaños ----
        'canonical_bytes_len',
        'frm_payload_len',

        // ---- NUEVO: runtime / OS ----
        'event_loop_p50_ms',
        'event_loop_p95_ms',
        'event_loop_max_ms',
        'loadavg_1m',
        'loadavg_5m',
        'loadavg_15m',
        'cpu_temp_c',
        'cpu_freq_khz',

        // ---- NUEVO: counters snapshot ----
        'mqtt_reconnects',
        'mqtt_disconnects',
        'iota_failures',
        'received',
        'skipped',
        'busy_drops',
        'notarized',
      ].join(',') + '\n',
      'utf8'
    );
  }
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function appendMetric(row) {
  ensureCsvHeader();

  const fields = [
    row.ts_iso,

    row.device_id,
    row.device_id_raw,

    row.op,
    row.digest,
    row.notarization_id,
    row.sha25610,

    row.ms_total,
    row.ms_iota,
    row.lat_ttn_to_oracle_ms,
    row.lat_end_to_end_ms,

    row.rssi,
    row.snr,
    row.f_port,

    row.gas_comp,
    row.gas_storage,
    row.gas_rebate,
    row.gas_nonref,

    row.cpu_user_ms,
    row.cpu_system_ms,
    row.rss_bytes,
    row.heap_used_bytes,

    // breakdown interno
    row.ms_parse_json,
    row.ms_hash,
    row.ms_build_and_execute,

    // tamaños
    row.canonical_bytes_len,
    row.frm_payload_len,

    // runtime / OS
    row.event_loop_p50_ms,
    row.event_loop_p95_ms,
    row.event_loop_max_ms,
    row.loadavg_1m,
    row.loadavg_5m,
    row.loadavg_15m,
    row.cpu_temp_c,
    row.cpu_freq_khz,

    // counters snapshot
    row.mqtt_reconnects,
    row.mqtt_disconnects,
    row.iota_failures,
    row.received,
    row.skipped,
    row.busy_drops,
    row.notarized,
  ].map(csvEscape);

  fs.appendFileSync(METRICS_CSV, fields.join(',') + '\n', 'utf8');
}

function appendEventJsonl(obj) {
  fs.appendFileSync(EVENTS_JSONL, JSON.stringify(obj) + '\n', 'utf8');
}

// ---- perf helpers (CPU/RAM) ----
function perfStart() {
  return {
    t0: Date.now(),
    cpu0: process.cpuUsage(),
  };
}
function perfEnd(p0) {
  const t1 = Date.now();
  const cpu = process.cpuUsage(p0.cpu0); // delta µs
  const mem = process.memoryUsage();
  return {
    t1,
    ms_total: t1 - p0.t0,
    cpu_user_ms: cpu.user / 1000,
    cpu_system_ms: cpu.system / 1000,
    rss_bytes: mem.rss,
    heap_used_bytes: mem.heapUsed,
  };
}

// ---- extractors ----
function normalizeObjectId(id) {
  if (!id) return id;
  const s = String(id).trim();
  return s.startsWith('0x') ? s : `0x${s}`;
}
function extractNotarizationId(output) {
  try {
    if (output?.id?.object_id) return normalizeObjectId(output.id.object_id());
  } catch {}
  if (output?.id) return normalizeObjectId(output.id);
  return null;
}
function extractDigest(res) {
  return (
    res?.response?.digest ||
    res?.digest ||
    res?.effects?.transactionDigest ||
    res?.transactionDigest
  );
}
function extractGasUsed(res) {
  const g = res?.effects?.gasUsed || res?.response?.effects?.gasUsed || null;
  if (!g) return null;
  return {
    computationCost: g.computationCost ?? g.computation_cost ?? null,
    storageCost: g.storageCost ?? g.storage_cost ?? null,
    storageRebate: g.storageRebate ?? g.storage_rebate ?? null,
    nonRefundableStorageFee: g.nonRefundableStorageFee ?? g.non_refundable_storage_fee ?? null,
  };
}
function toEpochMs(tsLike) {
  const n = Date.parse(tsLike);
  return Number.isFinite(n) ? n : null;
}

// ---- Notarization init ----
if (typeof notar.start === 'function') {
  await notar.start();
}

const iotaClient = new IotaClient({ url: IOTA_RPC });

// signer desde CLI (activo) + wrapper Ed25519KeypairSigner
const { signer: keypair, sender, alias } = getSignerFromIotaCli();
const signer = new Ed25519KeypairSigner(keypair);

console.log('🌐 IOTA RPC:', IOTA_RPC);
console.log('📡 TTN host:', host);
console.log('👤 MQTT username:', mqttUsername);
console.log('📡 Topic:', topic);
console.log('🏷️ ORACLE_TAG:', ORACLE_TAG);
console.log('🧯 NOTARIZE_EVERY_N:', N);
console.log('👤 sender =', sender);
console.log('🏷️ alias  =', alias);

// crear NotarizationClient correctamente
const ro = await notar.NotarizationClientReadOnly.create(iotaClient);
const nc = await notar.NotarizationClient.create(ro, signer);

console.log('✅ NotarizationClient ready');
console.log('   senderAddress =', nc.senderAddress());
console.log('   packageId     =', nc.packageId());
console.log('   network       =', nc.network());

// ---- device(alias) -> notarizationId (persistente) ----
const deviceMap = loadMap(); // { "nodo1": "0x...", "nodo2": "0x..." }
const inFlight = new Set();

// ---- MQTT ----
const client = mqtt.connect(`mqtts://${host}:8883`, {
  username: mqttUsername,
  password: TTN_API_KEY,
});

client.on('reconnect', () => { COUNTERS.mqtt_reconnects++; });
client.on('close', () => { COUNTERS.mqtt_disconnects++; });

let counter = 0;

client.on('connect', () => {
  console.log('✅ Connected to TTN MQTT');
  client.subscribe(topic, (err) => {
    if (err) console.error('❌ Subscribe error:', err.message || err);
    else console.log('✅ Subscribed');
  });
});

client.on('message', async (_t, msg) => {
  COUNTERS.received++;

  const perf0 = perfStart();
  const ts_iso = new Date().toISOString();

  let deviceIdForFinally = 'unknown';

  // breakdown placeholders
  let ms_parse_json = null;
  let ms_hash = null;
  let ms_build_and_execute = null;
  let canonical_bytes_len = null;
  let frm_payload_len = null;

  try {
    const t_local_rx_ms = Date.now();

    // parse JSON timing
    const t_parse0 = Date.now();
    const j = JSON.parse(msg.toString());
    ms_parse_json = Date.now() - t_parse0;

    const up = j?.uplink_message ?? {};
    const rx = up?.rx_metadata?.[0] ?? {};

    const ttn_received_at = j?.received_at ?? up?.received_at ?? null;
    const t_ttn_rx_ms = ttn_received_at ? toEpochMs(ttn_received_at) : null;

    const payload = {
      ts: ttn_received_at ?? ts_iso,
      device_id: j?.end_device_ids?.device_id ?? '',
      f_port: up?.f_port ?? null,
      frm_payload_b64: up?.frm_payload ?? '',
      rssi: rx?.rssi ?? null,
      snr: rx?.snr ?? null,
      oracle: 'ttn->iota(notarization)',
      tag: ORACLE_TAG,
      v: 1,
    };

    const rawDeviceId = payload.device_id || 'unknown';
    const deviceId = DEVICE_ALIAS[rawDeviceId] || rawDeviceId;
    deviceIdForFinally = deviceId;

    // hash timing
    const t_hash0 = Date.now();
    const canonical = stringify(payload);
    canonical_bytes_len = Buffer.byteLength(canonical, 'utf8');
    frm_payload_len = payload.frm_payload_b64 ? String(payload.frm_payload_b64).length : 0;

    const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
    ms_hash = Date.now() - t_hash0;

    const sha10 = sha256.slice(0, 10);

    counter += 1;
    if (counter % N !== 0) {
      COUNTERS.skipped++;
      console.log('📝 (skip)', deviceId, sha10);
      return;
    }

    if (inFlight.has(deviceId)) {
      COUNTERS.busy_drops++;
      console.log('⏳ (busy)', deviceId, sha10);
      return;
    }
    inFlight.add(deviceId);

    const meta = JSON.stringify({
      device_id: deviceId,         // alias
      device_id_raw: rawDeviceId,  // raw TTN
      ts: payload.ts,
      tag: ORACLE_TAG,
    });

    let op = 'update';
    let res;

    let notarization_id = deviceMap[deviceId] ? normalizeObjectId(deviceMap[deviceId]) : null;

    const t_iota_submit_ms = Date.now();

    // build+execute timing (incluye firma + submit + wait)
    const t_build0 = Date.now();

    if (!notarization_id) {
      op = 'create';

      res = await nc
        .createDynamic()
        .withStringState(sha256, meta)
        .withImmutableDescription(`TTN uplink sha256 - ${ORACLE_TAG} - device=${deviceId}`)
        .finish()
        .buildAndExecute(nc);

      notarization_id = extractNotarizationId(res?.output);
      if (!notarization_id) throw new Error('No pude extraer notarizationId del createDynamic().');

      deviceMap[deviceId] = notarization_id;
      saveMap(deviceMap);
    } else {
      const st = notar.State.fromString(sha256, meta);
      res = await nc.updateState(st, notarization_id).buildAndExecute(nc);
    }

    ms_build_and_execute = Date.now() - t_build0;

    const t_iota_done_ms = Date.now();
    const ms_iota = t_iota_done_ms - t_iota_submit_ms;

    const perf = perfEnd(perf0);

    const digest = extractDigest(res);
    const gas = extractGasUsed(res) || {};

    const lat_ttn_to_oracle_ms = t_ttn_rx_ms !== null ? (t_local_rx_ms - t_ttn_rx_ms) : null;
    const lat_end_to_end_ms = t_ttn_rx_ms !== null ? (t_iota_done_ms - t_ttn_rx_ms) : null;

    // runtime/OS snapshots
    const el = eventLoopStatsAndReset();
    const la = getLoadAvg();
    const cpu_temp_c = getCpuTempC();
    const cpu_freq_khz = getCpuFreqKHz();

    COUNTERS.notarized++;

    console.log(`✅ ${op.toUpperCase()}`, deviceId, sha10, 'digest=', digest, `(${perf.ms_total}ms)`);

    appendMetric({
      ts_iso,
      device_id: deviceId,
      device_id_raw: rawDeviceId,

      op,
      digest,
      notarization_id,
      sha25610: sha10,

      ms_total: perf.ms_total,
      ms_iota,
      lat_ttn_to_oracle_ms,
      lat_end_to_end_ms,

      rssi: payload.rssi,
      snr: payload.snr,
      f_port: payload.f_port,

      gas_comp: gas.computationCost,
      gas_storage: gas.storageCost,
      gas_rebate: gas.storageRebate,
      gas_nonref: gas.nonRefundableStorageFee,

      cpu_user_ms: perf.cpu_user_ms,
      cpu_system_ms: perf.cpu_system_ms,
      rss_bytes: perf.rss_bytes,
      heap_used_bytes: perf.heap_used_bytes,

      // breakdown
      ms_parse_json,
      ms_hash,
      ms_build_and_execute,

      // sizes
      canonical_bytes_len,
      frm_payload_len,

      // runtime/OS
      event_loop_p50_ms: el.event_loop_p50_ms,
      event_loop_p95_ms: el.event_loop_p95_ms,
      event_loop_max_ms: el.event_loop_max_ms,
      loadavg_1m: la.loadavg_1m,
      loadavg_5m: la.loadavg_5m,
      loadavg_15m: la.loadavg_15m,
      cpu_temp_c,
      cpu_freq_khz,

      // counters snapshot
      mqtt_reconnects: COUNTERS.mqtt_reconnects,
      mqtt_disconnects: COUNTERS.mqtt_disconnects,
      iota_failures: COUNTERS.iota_failures,
      received: COUNTERS.received,
      skipped: COUNTERS.skipped,
      busy_drops: COUNTERS.busy_drops,
      notarized: COUNTERS.notarized,
    });

    appendEventJsonl({
      ts_iso,
      device_id: deviceId,
      device_id_raw: rawDeviceId,
      op,
      notarization_id,
      digest,
      timings: {
        ttn_received_at: payload.ts,
        t_ttn_rx_ms,
        t_local_rx_ms,
        t_iota_submit_ms,
        t_iota_done_ms,
        ms_iota,
        ms_total: perf.ms_total,
        lat_ttn_to_oracle_ms,
        lat_end_to_end_ms,

        // breakdown
        ms_parse_json,
        ms_hash,
        ms_build_and_execute,
      },
      sizes: {
        canonical_bytes_len,
        frm_payload_len,
      },
      runtime: {
        ...el,
        ...la,
        cpu_temp_c,
        cpu_freq_khz,
      },
      counters: { ...COUNTERS },
      perf: {
        cpu_user_ms: perf.cpu_user_ms,
        cpu_system_ms: perf.cpu_system_ms,
        rss_bytes: perf.rss_bytes,
        heap_used_bytes: perf.heap_used_bytes,
      },
      radio: { rssi: payload.rssi, snr: payload.snr },
      uplink: { f_port: payload.f_port, frm_payload_b64: payload.frm_payload_b64 },
      canonical_payload: payload,
      canonical_string: canonical,
      sha256,
      sha25610: sha10,
      gasUsed: gas,
    });
  } catch (e) {
    COUNTERS.iota_failures++;
    console.error('❌ Notarization runner error:', e?.message || e);
  } finally {
    inFlight.delete(deviceIdForFinally);
  }
});

client.on('error', (e) => console.error('❌ MQTT error:', e.message));
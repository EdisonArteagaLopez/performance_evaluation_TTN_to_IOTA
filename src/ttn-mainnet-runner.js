import 'dotenv/config';
import mqtt from 'mqtt';
import crypto from 'crypto';
import fs from 'fs';
import * as notarization from '@iota/notarization/node/index.js';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

import { IotaClient } from '@iota/iota-sdk/client';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Transaction } from '@iota/iota-sdk/transactions';

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
  IOTA_MNEMONIC,
  IOTA_GAS_BUDGET = '20000000',

  // logs
  LOG_DIR = './logs',
  LOG_FILE = 'ttn_iota_mainnet_metrics.csv',
} = process.env;

const host = TTN_HOST || `${TTN_REGION}.${TTN_DOMAIN}`;
const appUid = TTN_APP_UID || TTN_APP_ID;
const mqttUsername = TTN_MQTT_USERNAME || appUid;

if (!appUid) throw new Error('Missing TTN_APP_UID or TTN_APP_ID');
if (!TTN_API_KEY) throw new Error('Missing TTN_API_KEY');
if (!IOTA_MNEMONIC) throw new Error('Missing IOTA_MNEMONIC');

const topic = `v3/${appUid}/devices/${TTN_DEVICE_ID}/up`;

fs.mkdirSync(LOG_DIR, { recursive: true });
const logPath = path.join(LOG_DIR, LOG_FILE);

const csvWriter = createObjectCsvWriter({
  path: logPath,
  header: [
    { id: 'ts', title: 'ts' },
    { id: 'device_id', title: 'device_id' },
    { id: 'sha256', title: 'sha256' },
    { id: 'tx_digest', title: 'tx_digest' },
    { id: 'gas_computation', title: 'gas_computation' },
    { id: 'gas_storage', title: 'gas_storage' },
    { id: 'latency_ms', title: 'latency_ms' },
  ],
  append: fs.existsSync(logPath),
});

const client = new IotaClient({ url: IOTA_RPC });
const keypair = Ed25519Keypair.deriveKeypair(IOTA_MNEMONIC);
const sender = keypair.getPublicKey().toIotaAddress();

console.log('🌐 IOTA RPC:', IOTA_RPC);
console.log('👤 Sender:', sender);

const mqttClient = mqtt.connect(`mqtts://${host}:8883`, {
  username: mqttUsername,
  password: TTN_API_KEY,
});

mqttClient.on('connect', () => {
  console.log('✅ Connected to TTN MQTT');
  console.log('📡 Topic:', topic);
  mqttClient.subscribe(topic, (err) => {
    if (err) console.error('❌ Subscribe error:', err.message || err);
    else console.log('✅ Subscribed');
  });
});

mqttClient.on('message', async (_t, msg) => {
  const t0 = Date.now();
  try {
    const j = JSON.parse(msg.toString());
    const up = j?.uplink_message ?? {};

    const oracleDoc = {
      ts: j?.received_at ?? new Date().toISOString(),
      device_id: j?.end_device_ids?.device_id ?? '',
      f_port: up?.f_port ?? null,
      frm_payload_b64: up?.frm_payload ?? '',
      oracle: 'ttn->iota-mainnet',
      v: 1,
    };

    const sha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify(oracleDoc))
      .digest('hex');

    // Tx mínima (self-transfer): confirma que podemos ejecutar una tx por uplink
    const tx = new Transaction();
    tx.setSender(sender);
    tx.setGasBudget(BigInt(IOTA_GAS_BUDGET));

    const [coin] = tx.splitCoins(tx.gas, [1n]);
    tx.transferObjects([coin], sender);

    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });

    const gas = res?.effects?.gasUsed ?? {};
    const row = {
      ts: oracleDoc.ts,
      device_id: oracleDoc.device_id,
      sha256,
      tx_digest: res.digest,
      gas_computation: gas.computationCost ?? '',
      gas_storage: gas.storageCost ?? '',
      latency_ms: Date.now() - t0,
    };

    await csvWriter.writeRecords([row]);
    console.log('🧾', oracleDoc.device_id, 'digest=', res.digest, 'ms=', row.latency_ms);
  } catch (e) {
    console.error('❌ Runner error:', e?.message || e);
  }
});
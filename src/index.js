import 'dotenv/config';
import mqtt from 'mqtt';
import crypto from 'crypto';
import * as notarization from '@iota/notarization/node/index.js';
//import { Client as IotaClient, TaggedDataPayload } from '@iota/sdk';
import { Client as IotaClient } from '@iota/sdk';

const {
  // ===== TTN MQTT =====
  TTN_HOST,
  TTN_REGION = 'eu1',
  TTN_DOMAIN = 'cloud.thethings.network',

  TTN_APP_UID,
  TTN_APP_ID,
  TTN_MQTT_USERNAME,
  TTN_API_KEY,
  TTN_DEVICE_ID = '+',

  // ===== IOTA =====
  IOTA_NODE_URL = 'http://localhost:14265',
  IOTA_TAG_HEX = '54544E2D4F5241434C45', // "TTN-ORACLE" en hex
} = process.env;

const host = TTN_HOST || `${TTN_REGION}.${TTN_DOMAIN}`;
const appUid = TTN_APP_UID || TTN_APP_ID;
const mqttUsername = TTN_MQTT_USERNAME || appUid;


if (!appUid) {
  console.error('❌ Missing TTN_APP_UID or TTN_APP_ID');
  process.exit(1);
}
if (!TTN_API_KEY) {
  console.error('❌ Missing TTN_API_KEY');
  process.exit(1);
}
if (!mqttUsername) {
  console.error('❌ Missing TTN_MQTT_USERNAME (or TTN_APP_UID/TTN_APP_ID)');
  process.exit(1);
}
if (!IOTA_NODE_URL) {
  console.error('❌ Missing IOTA_NODE_URL');
  process.exit(1);
}

const topic = `v3/${appUid}/devices/${TTN_DEVICE_ID}/up`;

console.log('🔌 TTN host:', host);
console.log('👤 MQTT username:', mqttUsername);
console.log('📡 Topic:', topic);
console.log('🌐 IOTA node:', IOTA_NODE_URL);
console.log('🏷️ IOTA tag(hex):', IOTA_TAG_HEX);

// Node.js binding (Stardust) – inicialización típica
const iota = new IotaClient({ nodes: [IOTA_NODE_URL] });

const utf8ToHex = (s) => Buffer.from(s, 'utf8').toString('hex');

async function postTaggedData(tagHex, dataUtf8) {
    const dataHex = Buffer.from(dataUtf8, 'utf8').toString('hex');
  
    // Unit variant: expected unit → usar null (no {}).
    const secretManager = { Placeholder: null };
  
    const options = {
      payload: {
        type: 5,
        tag: tagHex,
        data: dataHex,
      },
    };
  
    const res = await iota.buildAndPostBlock(secretManager, options);
    return res?.blockId || res?.block_id || res;
  }
  
const client = mqtt.connect(`mqtts://${host}:8883`, {
  username: mqttUsername,
  password: TTN_API_KEY,
});

client.on('connect', () => {
  console.log('✅ Connected to TTN MQTT');
  client.subscribe(topic, (err) => {
    if (err) console.error('❌ Subscribe error:', err.message || err);
    else console.log('✅ Subscribed');
  });
});

client.on('message', async (_t, msg) => {
  const t0 = Date.now();
  try {
    const j = JSON.parse(msg.toString());
    const up = j?.uplink_message ?? {};
    const rx = up?.rx_metadata?.[0] ?? {};

    const payloadB64 = up?.frm_payload ?? '';

    const oracleDoc = {
      ts: j?.received_at ?? new Date().toISOString(),
      device_id: j?.end_device_ids?.device_id ?? '',
      f_port: up?.f_port ?? null,
      frm_payload_b64: payloadB64,
      rssi: rx?.rssi ?? null,
      snr: rx?.snr ?? null,
      sha256: crypto.createHash('sha256').update(payloadB64).digest('hex'),
      oracle: 'ttn->iota(tagged-data)',
      v: 1,
    };

    const blockId = await postTaggedData(IOTA_TAG_HEX, JSON.stringify(oracleDoc));
    console.log(`🧱 IOTA block published: ${blockId} (${Date.now() - t0} ms)`);
  } catch (e) {
    console.error('❌ Oracle error:', e?.message || e);
  }
});

client.on('error', (e) => console.error('❌ MQTT error:', e.message || e));
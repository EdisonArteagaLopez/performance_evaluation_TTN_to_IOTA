import 'dotenv/config';
import crypto from 'crypto';

import {
  start,
  NotarizationClient,
} from '@iota/notarization/node/index.js';

// ✅ Inicializa WASM/entorno (en tu build el init es start())
start();

const {
  IOTA_RPC = 'https://api.mainnet.iota.cafe',
  IOTA_MNEMONIC,
} = process.env;

if (!IOTA_MNEMONIC) throw new Error('Missing IOTA_MNEMONIC');

const notarizationClient = new NotarizationClient({
  url: IOTA_RPC,
  mnemonic: IOTA_MNEMONIC,
});

const shaHex = crypto.createHash('sha256').update('hello-notarization').digest('hex');
const version = 'v1';

// Nota: withStringState pide 2 args (lo confirmaste con .length=2)
const { output, response } = await notarizationClient
  .createDynamic()
  .withStringState(shaHex, version)
  .withImmutableDescription('oracle smoke test')
  .withUpdatableMetadata('ttn->iota smoke')
  .finish()
  .buildAndExecute(notarizationClient);

console.log('✅ NOTARIZE SMOKE OK');
console.log({ output, response });
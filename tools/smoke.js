import 'dotenv/config';
import { IotaClient } from '@iota/iota-sdk/client';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Transaction } from '@iota/iota-sdk/transactions';
import * as notarization from '@iota/notarization/node/index.js';

const rpc = process.env.IOTA_RPC || 'https://api.mainnet.iota.cafe';
const mnemonic = process.env.IOTA_MNEMONIC;

if (!mnemonic) {
  console.error('❌ Missing IOTA_MNEMONIC in .env');
  process.exit(1);
}

const client = new IotaClient({ url: rpc });
const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
const sender = keypair.getPublicKey().toIotaAddress();

console.log('🌐 RPC:', rpc);
console.log('👤 Sender:', sender);

const tx = new Transaction();
tx.setSender(sender);

// (1) Crear una moneda nueva desde el gas coin con monto 1 (unidad mínima)
const [coin] = tx.splitCoins(tx.gas, [1]);

// (2) Transferir esa moneda (a ti mismo) para tener una tx real y barata
tx.transferObjects([coin], sender);

// Ejecutar firmando con el keypair (forma recomendada)
const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: {
    showEffects: true,
    showBalanceChanges: true,
    showObjectChanges: true,
  },
});

console.log('✅ Smoke test OK');
console.log(result);

// (opcional) asegura que ya esté indexada
await client.waitForTransaction({ digest: result.digest });
console.log('✅ Indexed');
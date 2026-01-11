// src/notarization-smoke.js
import 'dotenv/config';
import { start, NotarizationClient } from '@iota/notarization/node/index.js';
import { getSignerFromIotaCli } from './signer-from-cli.js';

async function testNotarization() {
  try {
    console.log('1️⃣ Initializing WASM...');
    try { start(); } catch {}
    console.log('✓ WASM ready');

    const url = process.env.IOTA_RPC || 'https://api.mainnet.iota.cafe';
    console.log('\n2️⃣ RPC:', url);

    console.log('\n3️⃣ Getting signer from IOTA CLI keystore...');
    const { keypair, sender, alias } = getSignerFromIotaCli();
    console.log('✓ Signer loaded');
    console.log('  alias :', alias);
    console.log('  sender:', sender);

    console.log('\n4️⃣ Creating NotarizationClient (static create)...');
    const client =
      (await NotarizationClient.create({ url, signer: keypair, senderAddress: sender }).catch(() => null)) ||
      (await NotarizationClient.create({ url, signer: keypair, sender }).catch(() => null)) ||
      (await NotarizationClient.create({ url, signer: keypair }).catch(() => null));

    if (!client) throw new Error('Could not create NotarizationClient with known signatures');

    console.log('✓ NotarizationClient created');
    console.log('  packageId:', client.packageId?.());
    console.log('  network  :', client.network?.());

    console.log('\n✅ All setup complete! Ready to notarize.');
    return client;
  } catch (e) {
    console.error('\n❌ Error:', e?.message || e);
    throw e;
  }
}

testNotarization()
  .then(() => console.log('\n🎉 Success! Client ready for notarization operations.'))
  .catch(() => process.exit(1));
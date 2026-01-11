// src/notarization-client-create-smoke.js
import 'dotenv/config';
import { start } from '@iota/notarization/node/index.js';
import { NotarizationClientReadOnly, NotarizationClient } from '@iota/notarization/node/index.js';
import { Ed25519KeypairSigner } from '@iota/iota-interaction-ts/node/test_utils/index.js';
import { IotaClient } from '@iota/iota-sdk/client';
import { getSignerFromIotaCli } from './signer-from-cli.js';

const RPC = process.env.IOTA_RPC || 'https://api.mainnet.iota.cafe';

async function main() {
  console.log('🌐 RPC =', RPC);
  
  // 1. Inicializar WASM
  await start();
  console.log('✅ WASM initialized');
  
  // 2. Crear cliente IOTA
  const iotaClient = new IotaClient({ url: RPC });
  console.log('✅ IOTA client created');
  
  // 3. Obtener keypair del CLI
  const { signer: keypair, sender, alias } = getSignerFromIotaCli();
  console.log('👤 sender =', sender);
  console.log('🏷️ alias  =', alias);
  
  // 4. Envolver el keypair en Ed25519KeypairSigner (desde test_utils)
  console.log('\n🔑 Creating Ed25519KeypairSigner...');
  const signer = new Ed25519KeypairSigner(keypair);
  console.log('✅ Signer created');
  
  // 5. Crear NotarizationClientReadOnly
  console.log('\n1️⃣ Creating NotarizationClientReadOnly...');
  const readOnlyClient = await NotarizationClientReadOnly.create(iotaClient);
  console.log('✅ ReadOnly client created');
  console.log('   packageId =', readOnlyClient.packageId());
  
  // 6. Crear NotarizationClient (SOLO 2 parámetros!)
  console.log('\n2️⃣ Creating NotarizationClient...');
  const notarizationClient = await NotarizationClient.create(
    readOnlyClient,
    signer  // NO pasar sender - se deriva automáticamente del signer
  );
  console.log('✅ NotarizationClient created!');
  console.log('   senderAddress =', notarizationClient.senderAddress());
  console.log('   packageId     =', notarizationClient.packageId());
  console.log('   network       =', notarizationClient.network());
  
  // 7. Probar creando una notarización
  console.log('\n3️⃣ Creating a test notarization...');
  const testData = 'Hello IOTA Notarization from Node.js!';
  
  const { output: notarization, response } = await notarizationClient
    .createDynamic()
    .withStringState(testData, 'Test from CLI integration')
    .withImmutableDescription('Test notarization via WASM bindings')
    .finish()
    .buildAndExecute(notarizationClient);
  
  console.log('✅ Notarization created!');
  console.log('   TX Digest:', response.digest);
  console.log('   Notarization ID:', notarization.id);
  console.log('   State data:', notarization.state.data.toString());
  
  console.log('\n🎉 SUCCESS - Everything works!');
  
  return { notarizationClient, notarization };
}

main().catch((e) => {
  console.error('\n💥 FAIL:', e?.message || e);
  console.error(e.stack);
  process.exit(1);
});
import { getSignerFromIotaCli } from './signer-from-cli.js';

const r = getSignerFromIotaCli();
console.log('✅ Signer OK');
console.log('alias   =', r.alias);
console.log('sender  =', r.sender);
console.log('matched =', r.matched); // muestra scheme + estrategia, no secretos
import * as n from '@iota/notarization/node/index.js';

function keysOf(fnOrObj) {
  return fnOrObj ? Object.getOwnPropertyNames(fnOrObj).sort() : [];
}

console.log('Exports (top-level):');
console.log(Object.keys(n).sort().join('\n'));

console.log('\nNotarizationClient static keys:');
console.log(keysOf(n.NotarizationClient).join('\n'));
console.log('\nNotarizationClient proto keys:');
console.log(keysOf(n.NotarizationClient?.prototype).join('\n'));

console.log('\nNotarizationClientReadOnly static keys:');
console.log(keysOf(n.NotarizationClientReadOnly).join('\n'));
console.log('\nNotarizationClientReadOnly proto keys:');
console.log(keysOf(n.NotarizationClientReadOnly?.prototype).join('\n'));

console.log('\nWasmManagedCoreClient static keys:');
console.log(keysOf(n.WasmManagedCoreClient).join('\n'));
console.log('\nWasmManagedCoreClient proto keys:');
console.log(keysOf(n.WasmManagedCoreClient?.prototype).join('\n'));

console.log('\nWasmManagedCoreClientReadOnly static keys:');
console.log(keysOf(n.WasmManagedCoreClientReadOnly).join('\n'));
console.log('\nWasmManagedCoreClientReadOnly proto keys:');
console.log(keysOf(n.WasmManagedCoreClientReadOnly?.prototype).join('\n'));

console.log('\nstart typeof =', typeof n.start);
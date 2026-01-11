import crypto from 'crypto';
import {
  NotarizationBuilderLocked,
  State,
  Data,
} from '@iota/notarization/node/index.js';

const shaHex = crypto.createHash('sha256').update('hello').digest('hex');
const shaBytes = crypto.createHash('sha256').update('hello').digest(); // Buffer(32)

console.log('shaHex=', shaHex);
console.log('shaBytes len=', shaBytes.length);

console.log('\n--- Trying raw string ---');
try {
  new NotarizationBuilderLocked().withStringState(shaHex);
  console.log('OK raw string');
} catch (e) {
  console.log('FAIL raw string:', e?.message || e);
}

console.log('\n--- Trying raw Uint8Array ---');
try {
  new NotarizationBuilderLocked().withBytesState(new Uint8Array(shaBytes));
  console.log('OK raw bytes');
} catch (e) {
  console.log('FAIL raw bytes:', e?.message || e);
}

console.log('\n--- Trying State.fromBytes + withBytesState ---');
try {
  const st = State.fromBytes(new Uint8Array(shaBytes));
  new NotarizationBuilderLocked().withBytesState(st);
  console.log('OK State.fromBytes');
} catch (e) {
  console.log('FAIL State.fromBytes:', e?.message || e);
}

console.log('\n--- Trying Data(...) + withBytesState ---');
try {
  const d = new Data(new Uint8Array(shaBytes));
  new NotarizationBuilderLocked().withBytesState(d);
  console.log('OK Data(...)');
} catch (e) {
  console.log('FAIL Data(...) :', e?.message || e);
}

console.log('\n--- Done ---');
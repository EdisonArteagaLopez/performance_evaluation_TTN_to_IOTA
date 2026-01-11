// src/debug-keystore.js
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const keystorePath = path.join(homedir(), '.iota', 'iota_config', 'iota.keystore');
const parsed = JSON.parse(readFileSync(keystorePath, 'utf8'));
const entries = Array.isArray(parsed) ? parsed : parsed.keys;

const activeEntry = entries.find(e => e.alias === 'magical-chrysoberyl');

console.log('=== KEYSTORE DEBUG ===');
console.log('Alias:', activeEntry.alias);
console.log('Address:', activeEntry.address);
console.log('Key.type:', activeEntry.key.type);
console.log('Key.value type:', typeof activeEntry.key.value);
console.log('Key.value is Array?:', Array.isArray(activeEntry.key.value));

if (typeof activeEntry.key.value === 'string') {
  console.log('Key.value string length:', activeEntry.key.value.length);
  console.log('Key.value starts with:', activeEntry.key.value.substring(0, 30) + '...');
} else if (Array.isArray(activeEntry.key.value)) {
  console.log('Key.value array length:', activeEntry.key.value.length);
  console.log('First 10 bytes:', activeEntry.key.value.slice(0, 10));
  console.log('Byte at index 0 (scheme?):', activeEntry.key.value[0]);
} else if (typeof activeEntry.key.value === 'object') {
  console.log('Key.value object keys:', Object.keys(activeEntry.key.value));
}
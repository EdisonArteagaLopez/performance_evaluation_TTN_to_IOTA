// src/signer-from-cli.js
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Secp256k1Keypair } from '@iota/iota-sdk/keypairs/secp256k1';
import { Secp256r1Keypair } from '@iota/iota-sdk/keypairs/secp256r1';

/**
 * Decodifica una clave privada en formato Bech32 (iotaprivkey1...)
 * Formato: [flag_byte][32_bytes_secret_key]
 * flag_byte = scheme (0=Ed25519, 1=Secp256k1, 2=Secp256r1)
 */
function decodeIotaPrivateKey(bech32Key) {
  try {
    if (!bech32Key.startsWith('iotaprivkey1') && !bech32Key.startsWith('suiprivkey1')) {
      return null;
    }

    // Decodificar Bech32 manualmente
    const decoded = decodeBech32(bech32Key);
    
    if (!decoded || decoded.length !== 33) {
      throw new Error(`Invalid key length: expected 33 bytes, got ${decoded?.length}`);
    }

    const scheme = decoded[0]; // Primer byte es el scheme
    const secretKey = decoded.slice(1, 33); // Siguientes 32 bytes son la clave secreta

    if (scheme !== 0 && scheme !== 1 && scheme !== 2) {
      throw new Error(`Invalid scheme: ${scheme}`);
    }

    return { secretKey, schema: scheme };
  } catch (e) {
    console.error('Error decoding IOTA private key:', e.message);
    return null;
  }
}

/**
 * Decodificador Bech32 simple
 */
function decodeBech32(str) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  
  // Separar prefijo y datos
  const lastOne = str.lastIndexOf('1');
  if (lastOne === -1) throw new Error('No separator character');
  
  const data = str.slice(lastOne + 1);
  
  // Convertir caracteres a valores
  const values = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const val = CHARSET.indexOf(c);
    if (val === -1) throw new Error(`Invalid character: ${c}`);
    values.push(val);
  }
  
  // Quitar checksum (últimos 6 caracteres)
  const dataValues = values.slice(0, -6);
  
  // Convertir de base32 (5 bits) a base256 (8 bits)
  return convertBits(dataValues, 5, 8, false);
}

/**
 * Convierte entre diferentes bases de bits
 */
function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error('Invalid data');
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error('Invalid padding');
  }

  return new Uint8Array(result);
}

function decodeB64Any(str) {
  const s = String(str).trim();
  let b64 = (s.includes('-') || s.includes('_')) ? s.replace(/-/g, '+').replace(/_/g, '/') : s;
  while (b64.length % 4 !== 0) b64 += '=';
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function decodeHexAny(str) {
  const s = String(str).trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) throw new Error('Invalid hex');
  return Uint8Array.from(Buffer.from(s, 'hex'));
}

function extractBytes(maybeKey) {
  if (!maybeKey) throw new Error('empty key');

  // Caso especial: { type: "...", value: "..." }
  if (typeof maybeKey === 'object' && 'type' in maybeKey && 'value' in maybeKey) {
    return extractBytes(maybeKey.value);
  }

  // Primero intenta decodificar como iotaprivkey1...
  if (typeof maybeKey === 'string') {
    const decoded = decodeIotaPrivateKey(maybeKey);
    if (decoded) {
      return { secretKey: decoded.secretKey, schema: decoded.schema };
    }
  }

  // Array<number>
  if (Array.isArray(maybeKey) && maybeKey.every((x) => Number.isInteger(x))) {
    return { raw: Uint8Array.from(maybeKey) };
  }

  // Uint8Array / Buffer
  if (maybeKey instanceof Uint8Array) return { raw: maybeKey };

  // string hex/base64
  if (typeof maybeKey === 'string') {
    const s = maybeKey.trim();
    if (s.startsWith('0x') || (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0)) {
      return { raw: decodeHexAny(s) };
    }
    return { raw: decodeB64Any(s) };
  }

  // objeto genérico
  if (typeof maybeKey === 'object') {
    for (const field of ['value', 'key', 'data', 'secretKey', 'privateKey', 'secret', 'bytes']) {
      if (field in maybeKey) {
        return extractBytes(maybeKey[field]);
      }
    }
    throw new Error(`Unsupported key object shape. keys=${Object.keys(maybeKey).join(',')}`);
  }

  throw new Error(`Unsupported key type: ${typeof maybeKey}`);
}

function kpFromScheme(scheme, secret32) {
  switch (scheme) {
    case 0: return Ed25519Keypair.fromSecretKey(secret32);
    case 1: return Secp256k1Keypair.fromSecretKey(secret32);
    case 2: return Secp256r1Keypair.fromSecretKey(secret32);
    default: throw new Error(`Unknown scheme: ${scheme}`);
  }
}

function* secret32Candidates(bytes) {
  const n = bytes.length;
  if (n === 32) yield { where: 'exact32', secret32: bytes };
  if (n >= 32) yield { where: 'first32', secret32: bytes.slice(0, 32) };
  if (n >= 32) yield { where: 'last32', secret32: bytes.slice(n - 32) };
  for (let off = 1; off <= 4; off++) {
    if (n >= off + 32) yield { where: `off${off}+32`, secret32: bytes.slice(off, off + 32) };
  }
  if (n >= 33) yield { where: 'skip1_then32', secret32: bytes.slice(1, 33) };
}

export function getSignerFromIotaCli() {
  const sender = execSync(`iota client active-address`, { encoding: 'utf8' }).trim();

  const keystorePath = path.join(homedir(), '.iota', 'iota_config', 'iota.keystore');
  const parsed = JSON.parse(readFileSync(keystorePath, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : parsed.keys;

  if (!Array.isArray(entries)) {
    throw new Error(`Unexpected keystore format. top-level keys: ${Object.keys(parsed || {})}`);
  }

  const entry = entries.find((e) => e?.address?.toLowerCase?.() === sender.toLowerCase());
  if (!entry) throw new Error(`Active address ${sender} not found in keystore`);

  // 1) Extrae bytes y detecta si viene con schema
  const extracted = extractBytes(entry.key);

  // 2) Si ya viene decodificado con schema (formato Bech32)
  if (extracted.secretKey && extracted.schema !== undefined) {
    try {
      const signer = kpFromScheme(extracted.schema, extracted.secretKey);
      const derived = signer.getPublicKey().toIotaAddress();
      if (derived.toLowerCase() === sender.toLowerCase()) {
        return {
          sender,
          signer,
          alias: entry.alias,
          keystorePath,
          matched: { scheme: extracted.schema, where: 'bech32', rawLen: 'N/A' },
        };
      }
    } catch (e) {
      console.error('Failed with decoded Bech32:', e.message);
    }
  }

  // 3) Fallback: prueba combinaciones con raw bytes
  if (extracted.raw) {
    const raw = extracted.raw;
    const maybeScheme = raw.length >= 33 ? raw[0] : null;
    const schemeOrder = [0, 1, 2];
    if (maybeScheme === 0 || maybeScheme === 1 || maybeScheme === 2) {
      const idx = schemeOrder.indexOf(maybeScheme);
      if (idx >= 0) schemeOrder.unshift(schemeOrder.splice(idx, 1)[0]);
    }

    for (const scheme of schemeOrder) {
      for (const cand of secret32Candidates(raw)) {
        try {
          const signer = kpFromScheme(scheme, cand.secret32);
          const derived = signer.getPublicKey().toIotaAddress();
          if (derived.toLowerCase() === sender.toLowerCase()) {
            return {
              sender,
              signer,
              alias: entry.alias,
              keystorePath,
              matched: { scheme, where: cand.where, rawLen: raw.length },
            };
          }
        } catch {
          // sigue probando
        }
      }
    }
  }

  // 4) No se pudo derivar
  throw new Error(
    `Could not derive signer for active address.\n` +
    `active=${sender}\n` +
    `alias=${entry.alias}\n` +
    `extracted=${JSON.stringify({ hasSecretKey: !!extracted.secretKey, hasRaw: !!extracted.raw })}`
  );
}
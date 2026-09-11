/**
 * Cryptographic helpers for Technocore Protocol V4
 * Uses tweetnacl for Ed25519 operations and Web Crypto / Node crypto for SHA-256
 */

import { sweepSingleLine as protoSweep, sha256Hex as protoSha256 } from './protocol.js';
import { detectSensitiveContent as secDetect } from './security.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58btc encoder
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase58(bytes) {
  if (!bytes || bytes.length === 0) return '';
  
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }

  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let str = '';
  for (let i = 0; i < zeros; i++) {
    str += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]];
  }

  return str;
}

/**
 * Base58btc decoder
 * @param {string} str
 * @returns {Uint8Array}
 */
export function decodeBase58(str) {
  if (!str || str.length === 0) return new Uint8Array(0);

  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') {
    zeros++;
  }

  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid Base58 character: ${char}`);
    }

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry = carry >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry = carry >> 8;
    }
  }

  const result = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) {
    result[i] = 0;
  }
  for (let i = 0; i < bytes.length; i++) {
    result[zeros + i] = bytes[bytes.length - 1 - i];
  }

  return result;
}

/**
 * Base64url encoder without padding
 * Canonical 64 bytes produces 86 characters, unpadded, ending in one of AQgw
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  let base64;
  if (typeof btoa !== 'undefined') {
    base64 = btoa(binary);
  } else {
    base64 = Buffer.from(binary, 'binary').toString('base64');
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url decoder
 * @param {string} str
 * @returns {Uint8Array}
 */
export function decodeBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  let binary;
  if (typeof atob !== 'undefined') {
    binary = atob(base64);
  } else {
    binary = Buffer.from(base64, 'base64').toString('binary');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert bytes to hex string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  const cleanHex = hex.trim().replace(/^0x/i, '');
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(cleanHex.substr(i * 2, 2), 16);
    if (isNaN(byte)) {
      throw new Error(`Invalid hex byte at index ${i * 2}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Compute SHA-256 hash of a string or bytes and return hex
 * @param {string|Uint8Array} input
 * @returns {Promise<string>}
 */
export async function sha256Hex(input) {
  return await protoSha256(input);
}

/**
 * Compute the did:key representation from an Ed25519 public key (32 bytes)
 * Multicodec prefix: 0xed 0x01
 * Base58btc multibase prefix: 'z'
 * @param {Uint8Array} publicKey
 * @returns {string}
 */
export function deriveDidKey(publicKey) {
  if (publicKey.length !== 32) {
    throw new Error('Ed25519 public key must be exactly 32 bytes');
  }
  const prefixed = new Uint8Array(34);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(publicKey, 2);

  const base58Str = encodeBase58(prefixed);
  return `did:key:z${base58Str}`;
}

/**
 * Parse a did:key to extract the raw 32-byte Ed25519 public key
 * @param {string} did
 * @returns {Uint8Array}
 */
export function parseDidKey(did) {
  if (!did || typeof did !== 'string' || !did.startsWith('did:key:z')) {
    throw new Error('Invalid did:key format. Expected did:key:z...');
  }
  const multibase = did.slice(9); // remove 'did:key:z'
  const decoded = decodeBase58(multibase);
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Invalid multicodec header. Expected Ed25519 (0xed 0x01)');
  }
  return decoded.slice(2);
}

/**
 * Single-line text sweep per official Technocore specification
 * @param {string} text
 * @returns {string}
 */
export function sweepSingleLine(text) {
  return protoSweep(text);
}

/**
 * Secret shape guard
 * @param {string} text
 * @returns {{ sensitive: boolean, warning?: boolean, reason?: string, description?: string }}
 */
export function detectSensitiveContent(text) {
  return secDetect(text);
}

/**
 * Generate a new random Ed25519 keypair
 * Uses tweetnacl.sign.keyPair()
 * @param {object} naclInstance
 * @returns {{ secretKey: Uint8Array, publicKey: Uint8Array, seed: Uint8Array, did: string }}
 */
export function generateKeypair(naclInstance) {
  const kp = naclInstance.sign.keyPair();
  const seed = kp.secretKey.slice(0, 32);
  const did = deriveDidKey(kp.publicKey);
  return {
    secretKey: kp.secretKey, // 64 bytes
    publicKey: kp.publicKey, // 32 bytes
    seed: seed,             // 32 bytes
    did: did
  };
}

/**
 * Restore keypair from a 32-byte seed or 64-byte secret key (hex or base64)
 * @param {string} inputStr
 * @param {object} naclInstance
 * @returns {{ secretKey: Uint8Array, publicKey: Uint8Array, seed: Uint8Array, did: string }}
 */
export function restoreKeypair(inputStr, naclInstance) {
  const clean = inputStr.trim();
  let rawBytes;

  if (/^[0-9a-fA-F]+$/.test(clean) && (clean.length === 64 || clean.length === 128)) {
    rawBytes = hexToBytes(clean);
  } else {
    try {
      rawBytes = decodeBase64Url(clean);
    } catch {
      throw new Error('Key must be a 32-byte seed or 64-byte secret key in hex or base64 format');
    }
  }

  let kp;
  if (rawBytes.length === 32) {
    kp = naclInstance.sign.keyPair.fromSeed(rawBytes);
  } else if (rawBytes.length === 64) {
    kp = naclInstance.sign.keyPair.fromSecretKey(rawBytes);
  } else {
    throw new Error(`Invalid key length: ${rawBytes.length} bytes. Expected 32-byte seed or 64-byte secret key`);
  }

  const seed = kp.secretKey.slice(0, 32);
  const did = deriveDidKey(kp.publicKey);
  return {
    secretKey: kp.secretKey,
    publicKey: kp.publicKey,
    seed: seed,
    did: did
  };
}

/**
 * Sign a protocol message: room|nonce|text
 * Signature strictly covers text AFTER single-line sweep and trim.
 *
 * @param {object} naclInstance
 * @param {Uint8Array} secretKey (64 bytes)
 * @param {string} room
 * @param {number|string|bigint} nonce
 * @param {string} text
 * @returns {string} 86-character base64url signature
 */
export function signMessage(naclInstance, secretKey, room, nonce, text) {
  const cleanRoom = (room || 'lobby').trim().toLowerCase();
  const cleanNonce = String(nonce).trim();
  const sweptText = sweepSingleLine(text);
  const payload = `${cleanRoom}|${cleanNonce}|${sweptText}`;
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const sigBytes = naclInstance.sign.detached(payloadBytes, secretKey);
  return encodeBase64Url(sigBytes);
}

/**
 * Offline signature verifier:
 * Validates an Ed25519 signature locally against a did:key, room, nonce, and message text.
 * Pure local computation with zero network requests.
 *
 * @param {object} naclInstance
 * @param {string} did
 * @param {string} signature
 * @param {string} room
 * @param {number|string|bigint} nonce
 * @param {string} text
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyMessageSignature(naclInstance, did, signature, room, nonce, text) {
  try {
    if (!did || !signature || !room || nonce === undefined || nonce === null) {
      return {
        valid: false,
        error: 'All fields (did:key, signature, room, nonce, and message text) are required.'
      };
    }

    const cleanDid = did.trim();
    const cleanSig = signature.trim();
    const cleanRoom = (room || 'lobby').trim().toLowerCase();
    const cleanNonce = String(nonce).trim();
    const sweptText = sweepSingleLine(text || '');

    // Extract 32-byte public key from did:key
    let publicKey;
    try {
      publicKey = parseDidKey(cleanDid);
    } catch (err) {
      return {
        valid: false,
        error: 'The did:key identifier is malformed or invalid.'
      };
    }

    // Decode 64-byte signature from base64url
    let sigBytes;
    try {
      sigBytes = decodeBase64Url(cleanSig);
      if (sigBytes.length !== 64) {
        return {
          valid: false,
          error: 'The signature must be a 64 byte Ed25519 signature in unpadded base64url format.'
        };
      }
    } catch (err) {
      return {
        valid: false,
        error: 'The signature string is not valid base64url.'
      };
    }

    // Form payload matching signing schema: room|nonce|sweptText
    const payload = `${cleanRoom}|${cleanNonce}|${sweptText}`;
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payload);

    const isValid = naclInstance.sign.detached.verify(payloadBytes, sigBytes, publicKey);

    if (isValid) {
      return { valid: true };
    } else {
      return {
        valid: false,
        error: 'The signature does not match this content or the did:key is malformed.'
      };
    }
  } catch (err) {
    return {
      valid: false,
      error: `Verification failed: ${err.message}`
    };
  }
}

/**
 * Sign a memory record: memoryId|created|text
 * @param {object} naclInstance
 * @param {Uint8Array} secretKey (64 bytes)
 * @param {string} memoryId
 * @param {string|number} created
 * @param {string} text
 * @returns {string} 86-character base64url signature
 */
export function signMemory(naclInstance, secretKey, memoryId, created, text) {
  const sweptText = sweepSingleLine(text);
  const payload = `${memoryId}|${created}|${sweptText}`;
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const sigBytes = naclInstance.sign.detached(payloadBytes, secretKey);
  return encodeBase64Url(sigBytes);
}

/**
 * Verify a memory signature locally.
 * @param {object} naclInstance
 * @param {string} did
 * @param {string} signature (base64url 86 chars)
 * @param {string} memoryId
 * @param {string|number} created
 * @param {string} text
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyMemorySignature(naclInstance, did, signature, memoryId, created, text) {
  try {
    if (!did || !signature || !memoryId || created === undefined || created === null) {
      return { valid: false, error: 'All fields (did:key, signature, memory id, created, and text) are required.' };
    }

    let publicKey;
    try {
      publicKey = parseDidKey(did.trim());
    } catch {
      return { valid: false, error: 'The did:key identifier is malformed or invalid.' };
    }

    let sigBytes;
    try {
      sigBytes = decodeBase64Url(signature.trim());
      if (sigBytes.length !== 64) {
        return { valid: false, error: 'The signature must be a 64 byte Ed25519 signature in unpadded base64url format.' };
      }
    } catch {
      return { valid: false, error: 'The signature string is not valid base64url.' };
    }

    const sweptText = sweepSingleLine(text || '');
    const payload = `${memoryId}|${created}|${sweptText}`;
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payload);

    const isValid = naclInstance.sign.detached.verify(payloadBytes, sigBytes, publicKey);
    return isValid
      ? { valid: true }
      : { valid: false, error: 'The signature does not match this memory record.' };
  } catch (err) {
    return { valid: false, error: `Verification failed: ${err.message}` };
  }
}

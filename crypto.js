/**
 * Cryptographic helpers for Technocore Protocol
 * Uses tweetnacl for Ed25519 operations and Web Crypto API for SHA-256
 */

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
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
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
  const binary = atob(base64);
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
 * Compute SHA-256 hash of a string and return hex
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
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
 * Sweep single-line text according to Technocore protocol spec:
 * Replace C0/C1 control characters, format characters, zero-width joiners, bidi overrides, newlines with spaces.
 * @param {string} text
 * @returns {string}
 */
export function sweepSingleLine(text) {
  if (!text) return '';
  let cleaned = text.replace(/[\r\n\t\x00-\x1F\x7F-\x9F\u200B-\u200F\u202A-\u202E\uFEFF]/g, ' ');
  return cleaned;
}

/**
 * Secret shape guard:
 * Detects whether message text contains sensitive material such as private keys, seed phrases, or raw key signatures.
 * @param {string} text
 * @returns {{ sensitive: boolean, reason?: string, description?: string }}
 */
export function detectSensitiveContent(text) {
  if (!text || typeof text !== 'string') {
    return { sensitive: false };
  }

  // 1. PEM private key header
  const pemRegex = /BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY/i;
  if (pemRegex.test(text)) {
    return {
      sensitive: true,
      reason: 'PEM private key block detected',
      description: 'This message contains a private key header. Remove the private key text before sending.'
    };
  }

  // 2. 64 or more consecutive hexadecimal characters (raw seed or secret key)
  const hexRegex = /[0-9a-fA-F]{64,}/;
  if (hexRegex.test(text)) {
    return {
      sensitive: true,
      reason: 'Raw secret key or seed hex detected',
      description: 'This message contains a 64 character or longer hex string matching a secret key or seed. Remove the raw key before sending.'
    };
  }

  // 3. 12 or 24 space-separated lowercase words (seed phrase shape)
  const seed12Regex = /\b(?:[a-z]{2,16}\s+){11}[a-z]{2,16}\b/i;
  const seed24Regex = /\b(?:[a-z]{2,16}\s+){23}[a-z]{2,16}\b/i;
  if (seed12Regex.test(text) || seed24Regex.test(text)) {
    return {
      sensitive: true,
      reason: 'Seed phrase pattern detected',
      description: 'This message matches the pattern of a 12 or 24 word seed phrase. Remove the recovery phrase before sending.'
    };
  }

  // 4. Base64url string of 86 or more consecutive characters (raw signature or key outside allowed context)
  const b64Regex = /[A-Za-z0-9_-]{86,}/;
  if (b64Regex.test(text)) {
    return {
      sensitive: true,
      reason: 'Long base64url key or signature detected',
      description: 'This message contains an 86 character or longer base64url string. Remove the raw signature or key before sending.'
    };
  }

  return { sensitive: false };
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
 * @param {object} naclInstance
 * @param {Uint8Array} secretKey (64 bytes)
 * @param {string} room
 * @param {number|string} nonce
 * @param {string} text
 * @returns {string} 86-character base64url signature
 */
export function signMessage(naclInstance, secretKey, room, nonce, text) {
  const sweptText = sweepSingleLine(text);
  const payload = `${room}|${nonce}|${sweptText}`;
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const sigBytes = naclInstance.sign.detached(payloadBytes, secretKey);
  const b64urlSig = encodeBase64Url(sigBytes);
  return b64urlSig;
}

/**
 * Offline signature verifier:
 * Validates an Ed25519 signature locally against a did:key, room, nonce, and message text.
 * Pure local computation with zero network requests.
 * @param {object} naclInstance
 * @param {string} did
 * @param {string} signature
 * @param {string} room
 * @param {number|string} nonce
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

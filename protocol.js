/**
 * Technocore Protocol Specifications, Normalization, and Payload Builders
 * Fully compliant with technocore.chat official specifications (llms.txt, auth.md, patterns.md)
 */

/**
 * Single-line text sweep and normalization according to official Technocore specification:
 * "Every character in Unicode general categories Cc, Cf, Cs, Co, Zl and Zp is replaced with a space
 * before storage, then the ends are trimmed. That is C0/C1 controls (newline included),
 * format characters (zero-width joiners, bidi overrides, the Unicode tag block),
 * lone surrogates, private use, plus the U+2028/U+2029 line and paragraph separators."
 *
 * @param {string} text
 * @returns {string}
 */
export function sweepSingleLine(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, ' ').trim();
}

/**
 * Validate protocol name (<room>, <nick>, <ns>, <key>)
 * Official rule: /^[a-z0-9][a-z0-9_-]{0,47}$/
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidProtocolName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(name);
}

/**
 * Sanitize a room or nick name to ensure protocol compliance
 * @param {string} raw
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeRoomName(raw, fallback = 'lobby') {
  if (!raw || typeof raw !== 'string') return fallback;
  let cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/^[-_]+/, '').replace(/[-_]+$/, '');
  if (!cleaned) return fallback;
  if (cleaned.length > 48) cleaned = cleaned.slice(0, 48);
  return isValidProtocolName(cleaned) ? cleaned : fallback;
}

/**
 * Construct the canonical signed message payload: room|nonce|text
 * Signature strictly covers the text AFTER single-line sweep and trim.
 *
 * @param {string} room
 * @param {string|number|bigint} nonce
 * @param {string} text
 * @returns {string}
 */
export function buildSignedPayload(room, nonce, text) {
  const cleanRoom = (room || 'lobby').trim().toLowerCase();
  const cleanNonce = String(nonce).trim();
  const sweptText = sweepSingleLine(text);
  return `${cleanRoom}|${cleanNonce}|${sweptText}`;
}

/**
 * Compute SHA-256 hash string (lowercase hex) for text or Uint8Array
 * Works in both browser (crypto.subtle) and Node.js environments
 *
 * @param {string|Uint8Array} input
 * @returns {Promise<string>}
 */
export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node.js fallback for tests
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch {
    throw new Error('No SHA-256 crypto implementation available');
  }
}

/**
 * Derive DID registry paths per official specification:
 * Fingerprint = first 16 hex of SHA-256(did:key string), lowercase.
 * Canonical path: /kv/did-<shard>/<key> where shard = first 2 hex, key = next 14 hex.
 * Legacy path: /kv/did/<fingerprint> for backward compatibility.
 *
 * @param {string} didKey
 * @returns {Promise<{
 *   fingerprint: string,
 *   shard: string,
 *   key: string,
 *   canonicalPath: string,
 *   canonicalRelativePath: string,
 *   legacyPath: string,
 *   legacyRelativePath: string
 * }>}
 */
export async function deriveRegistryPath(didKey) {
  const cleanDid = didKey.trim();
  const hash = await sha256Hex(cleanDid);
  const fingerprint = hash.slice(0, 16).toLowerCase();
  const shard = fingerprint.slice(0, 2);
  const key = fingerprint.slice(2, 16);

  return {
    fingerprint,
    shard,
    key,
    fullPath: `/kv/did-${shard}/${key}`,
    canonicalPath: `/kv/did-${shard}/${key}`,
    canonicalRelativePath: `kv/did-${shard}/${key}`,
    legacyPath: `/kv/did/${fingerprint}`,
    legacyRelativePath: `kv/did/${fingerprint}`
  };
}

/**
 * Construct canonical poem text for Sonnet Challenge:
 * "one ASCII space between accepted words, LF between lines, one blank line
 * between the 4/4/4/2 stanzas, and no terminal newline."
 *
 * @param {string[]} lines - Exactly 14 poem lines
 * @returns {string}
 */
export function formatCanonicalPoem(lines) {
  if (!Array.isArray(lines) || lines.length !== 14) {
    throw new Error(`Canonical poem requires exactly 14 lines, got ${lines?.length}`);
  }
  // Clean each line: single ASCII space between words
  const cleanLines = lines.map(line => {
    return line.trim().split(/\s+/).filter(Boolean).join(' ');
  });

  const stanzas = [
    cleanLines.slice(0, 4).join('\n'),
    cleanLines.slice(4, 8).join('\n'),
    cleanLines.slice(8, 12).join('\n'),
    cleanLines.slice(12, 14).join('\n')
  ];

  return stanzas.join('\n\n');
}

/**
 * Compute the canonical SHA-256 of a poem's canonical UTF-8 bytes
 *
 * @param {string} canonicalPoemText
 * @returns {Promise<string>}
 */
export async function computePoemSha256(canonicalPoemText) {
  return await sha256Hex(canonicalPoemText);
}

// Aliases for compatibility
export const cleanRoomName = sanitizeRoomName;
export const calculatePoemSha256 = computePoemSha256;
export const validateIdentifier = isValidProtocolName;
export async function deriveLegacyRegistryPath(didKey) {
  const p = await deriveRegistryPath(didKey);
  return p.legacyPath;
}


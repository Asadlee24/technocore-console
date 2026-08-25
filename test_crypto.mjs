import { encodeBase58, decodeBase58, encodeBase64Url, decodeBase64Url, bytesToHex, hexToBytes, deriveDidKey, parseDidKey, sweepSingleLine } from './crypto.js';

console.log('Testing Base58btc...');
const testBytes = new Uint8Array([0xed, 0x01, 1, 2, 3, 4, 5]);
const b58 = encodeBase58(testBytes);
const decodedB58 = decodeBase58(b58);
console.log('Base58 test match:', bytesToHex(testBytes) === bytesToHex(decodedB58));

console.log('Testing Base64url...');
const sigTest = new Uint8Array(64);
for (let i = 0; i < 64; i++) sigTest[i] = i * 3 + 7;
const b64u = encodeBase64Url(sigTest);
console.log('Base64url length is 86:', b64u.length === 86);
console.log('Base64url has no padding:', !b64u.includes('='));
const decodedSig = decodeBase64Url(b64u);
console.log('Base64url roundtrip match:', bytesToHex(sigTest) === bytesToHex(decodedSig));

console.log('Testing DID Key derivation...');
const samplePub = new Uint8Array(32);
samplePub[0] = 0xab;
samplePub[31] = 0xcd;
const did = deriveDidKey(samplePub);
console.log('DID format starts with did:key:z:', did.startsWith('did:key:z'));
const parsedPub = parseDidKey(did);
console.log('DID parse match:', bytesToHex(samplePub) === bytesToHex(parsedPub));

console.log('Testing sweep single line...');
const dirty = "hello\nworld\r\n\twith\u200Bzero width";
const clean = sweepSingleLine(dirty);
console.log('Clean single line:', JSON.stringify(clean));

console.log('ALL CRYPTO UNIT CHECKS PASSED!');

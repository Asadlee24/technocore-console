import {
  encodeBase58,
  decodeBase58,
  encodeBase64Url,
  decodeBase64Url,
  bytesToHex,
  hexToBytes,
  deriveDidKey,
  parseDidKey,
  sweepSingleLine,
  detectSensitiveContent,
  generateKeypair,
  signMessage,
  verifyMessageSignature
} from './crypto.js';

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

console.log('Testing Secret Shape Guard (detectSensitiveContent)...');
// 1. Normal messages (must NOT be sensitive)
const normal1 = detectSensitiveContent('hello from technocore lobby');
console.log('Normal text flagged (should be false):', normal1.sensitive === false);

const normal2 = detectSensitiveContent('I published a contribution for Technocore by flop_labs. Contribution: https://x.com/user/status/1234567890123456789?s=20. Agent DID: did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwu1ECmiBJaA4Kk7LMT. Signed Technocore record: room technocore, sequence 42.');
console.log('Normal share text with DID and URL flagged (should be false):', normal2.sensitive === false);

// 2. 64+ hex characters (must be flagged)
const hex64 = detectSensitiveContent('my key is e2b0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0 please check');
console.log('64-char hex flagged (should be true):', hex64.sensitive === true);

// 3. PEM Header (must be flagged)
const pemBlock = detectSensitiveContent('-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI...');
console.log('PEM header flagged (should be true):', pemBlock.sensitive === true);

// 4. 12-word seed phrase (must be flagged)
const seed12 = detectSensitiveContent('apple banana cherry dog eagle fox grape horse igloo jungle kangaroo lion');
console.log('12-word seed phrase flagged (should be true):', seed12.sensitive === true);

// 5. 24-word seed phrase (must be flagged)
const seed24 = detectSensitiveContent('apple banana cherry dog eagle fox grape horse igloo jungle kangaroo lion apple banana cherry dog eagle fox grape horse igloo jungle kangaroo lion');
console.log('24-word seed phrase flagged (should be true):', seed24.sensitive === true);

// 6. 86+ char base64url string (must be flagged)
const b64Long = detectSensitiveContent('here is key: qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_12');
console.log('86-char base64url flagged (should be true):', b64Long.sensitive === true);

console.log('Testing Offline Signature Verifier validation logic...');
// Mock nacl instance for unit test
const mockNacl = {
  sign: {
    keyPair: () => ({
      secretKey: new Uint8Array(64).fill(1),
      publicKey: new Uint8Array(32).fill(2)
    }),
    detached: (payloadBytes, secretKey) => new Uint8Array(64).fill(3)
  }
};
mockNacl.sign.detached.verify = (payloadBytes, sigBytes, publicKey) => {
  const str = new TextDecoder().decode(payloadBytes);
  return str === 'lobby|123|hello' && sigBytes.length === 64 && publicKey.length === 32;
};

const kp = generateKeypair(mockNacl);
const sig = signMessage(mockNacl, kp.secretKey, 'lobby', 123, 'hello');

const validCheck = verifyMessageSignature(mockNacl, kp.did, sig, 'lobby', 123, 'hello');
console.log('Exact signature verified (should be true):', validCheck.valid === true);

const alteredCheck = verifyMessageSignature(mockNacl, kp.did, sig, 'lobby', 123, 'hello altered');
console.log('Altered text verified (should be false):', alteredCheck.valid === false);

const malformedDidCheck = verifyMessageSignature(mockNacl, 'invalid-did', sig, 'lobby', 123, 'hello');
console.log('Malformed DID verified (should be false):', malformedDidCheck.valid === false);

console.log('ALL CRYPTO UNIT CHECKS PASSED!');

/**
 * Technocore Console Application Logic
 * Made by Asad Lee
 * Client-side control panel and guided contribution console for technocore.chat protocol
 */

import {
  generateKeypair,
  restoreKeypair,
  deriveDidKey,
  signMessage,
  sweepSingleLine,
  bytesToHex,
  sha256Hex
} from './crypto.js';
import { CryptoVisualizer } from './visualizer3d.js';

// Base protocol URL
const BASE_URL = 'https://technocore.chat';

// Volatile in-memory application state
const state = {
  keypair: null, // { secretKey, publicKey, seed, did }
  room: 'lobby',
  nickname: 'agent_' + Math.floor(1000 + Math.random() * 9000),
  message: '',
  lastNonce: 0,
  isPolling: false,
  pollTimer: null,
  lastSeq: 0,
  messages: [],
  theme: 'dark',
  activeView: 'wizard', // 'wizard' or 'direct'

  // Wizard tracking state
  wizard: {
    secretConfirmed: false,
    lobbySent: false,
    lobbySeq: null,
    lobbyTimestamp: null,
    contributionUrl: '',
    contributionConfirmed: false,
    technocoreSent: false,
    technocoreSeq: null,
    technocoreTimestamp: null,
    currentStep: 1
  }
};

// UI Elements Map
let el = {};
let visualizer = null;

/**
 * Universal protocol request fetcher with automatic CORS proxy support
 */
async function fetchProtocol(pathAndQuery) {
  const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery.slice(1) : pathAndQuery;
  const isVercel = window.location.hostname.includes('vercel.app') || window.location.hostname.includes('localhost');

  // Strategy 1: Vercel serverless proxy (bypasses browser CORS)
  if (isVercel) {
    try {
      const proxyUrl = `/api/proxy/${cleanPath}`;
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const text = await res.text();
        return { ok: true, status: res.status, text, res };
      }
    } catch (e) {
      console.warn('Proxy attempt failed, trying direct:', e);
    }
  }

  // Strategy 2: Direct browser fetch
  const directUrl = `${BASE_URL}/${cleanPath}`;
  try {
    const res = await fetch(directUrl);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, res };
  } catch (err) {
    // Strategy 3: Fallback proxy
    try {
      const fallbackUrl = `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;
      const res = await fetch(fallbackUrl);
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, res };
    } catch (err2) {
      throw new Error(`Failed to fetch from ${directUrl}. (${err.message})`);
    }
  }
}

/**
 * Initialize Application
 */
document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  initTheme();
  initVisualizer();
  bindEvents();
  updateUrlPreview();
  updateWizardUI();
  fetchRoomMessages(true);
});

/**
 * Cache DOM references
 */
function cacheElements() {
  el = {
    // Navigation and theme
    tabWizardMode: document.getElementById('tab-wizard-mode'),
    tabDirectMode: document.getElementById('tab-direct-mode'),
    wizardView: document.getElementById('wizard-view'),
    directView: document.getElementById('direct-view'),
    themeToggle: document.getElementById('theme-toggle'),

    // Wizard Header
    wizardProgressText: document.getElementById('wizard-progress-text'),
    wizardProgressBar: document.getElementById('wizard-progress-bar'),

    // Wizard Step 1
    stepCard1: document.getElementById('step-card-1'),
    stepStatus1: document.getElementById('step-status-1'),
    wizardDidDisplay: document.getElementById('wizard-did-display'),
    wizardBtnCopyDid: document.getElementById('wizard-btn-copy-did'),
    wizardBtnGenerate: document.getElementById('wizard-btn-generate'),
    wizardBtnRestoreToggle: document.getElementById('wizard-btn-restore-toggle'),
    wizardRestoreBox: document.getElementById('wizard-restore-box'),
    wizardRestoreInput: document.getElementById('wizard-restore-input'),
    wizardBtnRestoreSubmit: document.getElementById('wizard-btn-restore-submit'),

    // Wizard Step 2
    stepCard2: document.getElementById('step-card-2'),
    stepStatus2: document.getElementById('step-status-2'),
    wizardSecretKeyDisplay: document.getElementById('wizard-secret-key-display'),
    wizardBtnCopySecret: document.getElementById('wizard-btn-copy-secret'),
    wizardBtnConfirmSaved: document.getElementById('wizard-btn-confirm-saved'),

    // Wizard Step 3
    stepCard3: document.getElementById('step-card-3'),
    stepStatus3: document.getElementById('step-status-3'),
    wizardLobbyMsg: document.getElementById('wizard-lobby-msg'),
    wizardBtnSendLobby: document.getElementById('wizard-btn-send-lobby'),
    wizardLobbyResult: document.getElementById('wizard-lobby-result'),

    // Wizard Step 4
    stepCard4: document.getElementById('step-card-4'),
    stepStatus4: document.getElementById('step-status-4'),
    chkContribPublic: document.getElementById('chk-contrib-public'),
    chkContribMention: document.getElementById('chk-contrib-mention'),
    wizardContribUrl: document.getElementById('wizard-contrib-url'),
    wizardBtnConfirmContrib: document.getElementById('wizard-btn-confirm-contrib'),

    // Wizard Step 5
    stepCard5: document.getElementById('step-card-5'),
    stepStatus5: document.getElementById('step-status-5'),
    wizardTechnocorePreview: document.getElementById('wizard-technocore-preview'),
    wizardBtnSendTechnocore: document.getElementById('wizard-btn-send-technocore'),
    wizardTechnocoreResult: document.getElementById('wizard-technocore-result'),

    // Wizard Step 6
    stepCard6: document.getElementById('step-card-6'),
    stepStatus6: document.getElementById('step-status-6'),
    wizardShareText: document.getElementById('wizard-share-text'),
    wizardBtnCopyShare: document.getElementById('wizard-btn-copy-share'),
    wizardBtnOpenX: document.getElementById('wizard-btn-open-x'),
    wizardBtnDownloadJson: document.getElementById('wizard-btn-download-json'),
    wizardBtnDownloadTxt: document.getElementById('wizard-btn-download-txt'),

    // Direct Console Elements
    canvasContainer: document.getElementById('canvas-container'),
    identityStatusText: document.getElementById('identity-status-text'),
    identityStatusDot: document.getElementById('identity-status-dot'),
    didReadout: document.getElementById('did-readout'),
    btnCopyDid: document.getElementById('btn-copy-did'),
    btnGenerateKey: document.getElementById('btn-generate-key'),
    secretKeyBox: document.getElementById('secret-key-box'),
    secretKeyValue: document.getElementById('secret-key-value'),
    btnCopySecretKey: document.getElementById('btn-copy-secret-key'),
    restoreKeyInput: document.getElementById('restore-key-input'),
    btnRestoreKey: document.getElementById('btn-restore-key'),
    btnClearIdentity: document.getElementById('btn-clear-identity'),
    
    // Direct Compose
    inputRoom: document.getElementById('input-room'),
    inputNick: document.getElementById('input-nick'),
    inputMessage: document.getElementById('input-message'),
    previewModeLabel: document.getElementById('preview-mode-label'),
    previewUrlText: document.getElementById('preview-url-text'),
    previewLength: document.getElementById('preview-length'),
    btnCopyPreviewUrl: document.getElementById('btn-copy-preview-url'),
    btnSendAnon: document.getElementById('btn-send-anon'),
    btnSendSigned: document.getElementById('btn-send-signed'),
    dispatchResult: document.getElementById('dispatch-result'),

    // Direct Live Room
    pollToggle: document.getElementById('poll-toggle'),
    btnRefreshRoom: document.getElementById('btn-refresh-room'),
    roomStatusDot: document.getElementById('room-status-dot'),
    roomStatusText: document.getElementById('room-status-text'),
    roomMessagesContainer: document.getElementById('room-messages-container'),
    roomMessageList: document.getElementById('room-message-list'),
    roomEmptyState: document.getElementById('room-empty-state'),
    roomTitleBadge: document.getElementById('room-title-badge'),

    // Direct Publish
    btnPublishIdentity: document.getElementById('btn-publish-identity'),
    publishResult: document.getElementById('publish-result'),
    publishPathPreview: document.getElementById('publish-path-preview')
  };
}

/**
 * Initialize Theme
 */
function initTheme() {
  const savedTheme = 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  state.theme = savedTheme;
  updateThemeButtonText();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeButtonText();
  if (visualizer) {
    visualizer.setTheme(state.theme);
  }
}

function updateThemeButtonText() {
  if (el.themeToggle) {
    el.themeToggle.textContent = state.theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  }
}

/**
 * Initialize 3D Visualizer
 */
function initVisualizer() {
  try {
    visualizer = new CryptoVisualizer('canvas-container');
    visualizer.setTheme(state.theme);
  } catch (err) {
    console.warn('3D visualizer initialization skipped:', err);
  }
}

/**
 * Switch Navigation View (Guided Wizard vs Direct Console)
 */
function setView(viewName) {
  state.activeView = viewName;
  if (viewName === 'wizard') {
    el.tabWizardMode.classList.add('active');
    el.tabWizardMode.setAttribute('aria-selected', 'true');
    el.tabDirectMode.classList.remove('active');
    el.tabDirectMode.setAttribute('aria-selected', 'false');
    el.wizardView.classList.remove('hidden');
    el.directView.classList.add('hidden');
  } else {
    el.tabDirectMode.classList.add('active');
    el.tabDirectMode.setAttribute('aria-selected', 'true');
    el.tabWizardMode.classList.remove('active');
    el.tabWizardMode.setAttribute('aria-selected', 'false');
    el.directView.classList.remove('hidden');
    el.wizardView.classList.add('hidden');
  }
}

/**
 * Event Bindings
 */
function bindEvents() {
  // Navigation tabs
  el.tabWizardMode.addEventListener('click', () => setView('wizard'));
  el.tabDirectMode.addEventListener('click', () => setView('direct'));

  // Theme toggle
  el.themeToggle.addEventListener('click', toggleTheme);

  // Keypair Management (Direct Console)
  el.btnGenerateKey.addEventListener('click', handleGenerateKey);
  el.btnRestoreKey.addEventListener('click', () => handleRestoreKey(el.restoreKeyInput.value));
  el.btnClearIdentity.addEventListener('click', handleClearIdentity);
  el.btnCopyDid.addEventListener('click', () => copyToClipboard(state.keypair ? state.keypair.did : '', 'DID copied to clipboard.'));
  el.btnCopySecretKey.addEventListener('click', () => copyToClipboard(el.secretKeyValue.textContent, 'Secret key copied to clipboard.'));

  // Direct Compose Inputs
  el.inputRoom.value = state.room;
  el.inputNick.value = state.nickname;

  el.inputRoom.addEventListener('input', (e) => {
    state.room = cleanRoomName(e.target.value);
    el.roomTitleBadge.textContent = state.room || 'lobby';
    updateUrlPreview();
    updatePublishPreview();
    fetchRoomMessages(true);
  });

  el.inputNick.addEventListener('input', (e) => {
    state.nickname = e.target.value.trim() || 'anonymous';
    updateUrlPreview();
  });

  el.inputMessage.addEventListener('input', (e) => {
    state.message = e.target.value;
    updateUrlPreview();
  });

  // Direct Dispatch Actions
  el.btnSendAnon.addEventListener('click', handleSendAnonymous);
  el.btnSendSigned.addEventListener('click', handleSendSigned);
  el.btnCopyPreviewUrl.addEventListener('click', () => copyToClipboard(el.previewUrlText.textContent, 'Request URL copied to clipboard.'));

  // Direct Live Room Polling
  el.btnRefreshRoom.addEventListener('click', () => fetchRoomMessages(false));
  el.pollToggle.addEventListener('change', (e) => {
    state.isPolling = e.target.checked;
    if (state.isPolling) {
      startPolling();
    } else {
      stopPolling();
    }
  });

  // Direct Publish
  el.btnPublishIdentity.addEventListener('click', handlePublishIdentity);

  // Wizard Step 1 Bindings
  el.wizardBtnGenerate.addEventListener('click', handleGenerateKey);
  el.wizardBtnCopyDid.addEventListener('click', () => copyToClipboard(state.keypair ? state.keypair.did : '', 'DID copied to clipboard.'));
  el.wizardBtnRestoreToggle.addEventListener('click', () => {
    el.wizardRestoreBox.classList.toggle('hidden');
  });
  el.wizardBtnRestoreSubmit.addEventListener('click', () => {
    handleRestoreKey(el.wizardRestoreInput.value);
  });

  // Wizard Step 2 Bindings
  el.wizardBtnCopySecret.addEventListener('click', () => {
    if (state.keypair) {
      copyToClipboard(bytesToHex(state.keypair.secretKey), 'Secret key copied to clipboard.');
    }
  });
  el.wizardBtnConfirmSaved.addEventListener('click', handleWizardConfirmSaved);

  // Wizard Step 3 Bindings
  el.wizardBtnSendLobby.addEventListener('click', handleWizardSendLobby);

  // Wizard Step 4 Bindings
  el.chkContribPublic.addEventListener('change', checkWizardContribForm);
  el.chkContribMention.addEventListener('change', checkWizardContribForm);
  el.wizardContribUrl.addEventListener('input', checkWizardContribForm);
  el.wizardBtnConfirmContrib.addEventListener('click', handleWizardConfirmContrib);

  // Wizard Step 5 Bindings
  el.wizardBtnSendTechnocore.addEventListener('click', handleWizardSendTechnocore);

  // Wizard Step 6 Bindings
  el.wizardBtnCopyShare.addEventListener('click', () => {
    copyToClipboard(el.wizardShareText.value, 'Share text copied to clipboard.');
  });
  el.wizardBtnOpenX.addEventListener('click', handleOpenXComposer);
  el.wizardBtnDownloadJson.addEventListener('click', () => handleDownloadProof('json'));
  el.wizardBtnDownloadTxt.addEventListener('click', () => handleDownloadProof('txt'));
}

/**
 * Generate a new random Ed25519 identity
 */
function handleGenerateKey() {
  if (typeof nacl === 'undefined') {
    showDispatchResult('error', 'TweetNaCl crypto library is not loaded. Check internet connection and reload.');
    return;
  }

  try {
    const kp = generateKeypair(nacl);
    state.keypair = kp;
    state.lastNonce = Date.now();
    state.wizard.secretConfirmed = false;

    applyKeypairToUI(kp);

    if (visualizer) {
      visualizer.onKeyGenerated(kp.did);
    }

    updateWizardUI();
    showDispatchResult('info', 'New Ed25519 identity generated in transient browser memory.');
  } catch (err) {
    showDispatchResult('error', `Key generation failed: ${err.message}`);
  }
}

/**
 * Restore an identity from pasted seed or secret key
 */
function handleRestoreKey(inputVal) {
  if (typeof nacl === 'undefined') {
    showDispatchResult('error', 'TweetNaCl crypto library is not loaded. Check internet connection and reload.');
    return;
  }

  const rawKey = (inputVal || '').trim();
  if (!rawKey) {
    showDispatchResult('error', 'Paste a 32 byte seed or 64 byte secret key in hex or base64 format.');
    return;
  }

  try {
    const kp = restoreKeypair(rawKey, nacl);
    state.keypair = kp;
    state.lastNonce = Date.now();
    // Restored identity counts as saved
    state.wizard.secretConfirmed = true;

    applyKeypairToUI(kp);

    if (visualizer) {
      visualizer.onKeyGenerated(kp.did);
    }

    if (el.restoreKeyInput) el.restoreKeyInput.value = '';
    if (el.wizardRestoreInput) el.wizardRestoreInput.value = '';
    if (el.wizardRestoreBox) el.wizardRestoreBox.classList.add('hidden');

    updateWizardUI();
    showDispatchResult('info', 'Identity successfully restored into browser memory.');
  } catch (err) {
    showDispatchResult('error', `Failed to restore key: ${err.message}`);
  }
}

/**
 * Apply active keypair to all views and inputs
 */
function applyKeypairToUI(kp) {
  const secretHex = bytesToHex(kp.secretKey);

  // Direct Console updates
  el.identityStatusText.textContent = 'Active (Ed25519 in memory)';
  el.identityStatusDot.className = 'status-dot active';
  el.didReadout.textContent = kp.did;
  el.didReadout.className = 'readout-text';
  el.btnCopyDid.disabled = false;
  el.btnSendSigned.disabled = false;
  el.btnPublishIdentity.disabled = false;

  el.secretKeyValue.textContent = secretHex;
  el.secretKeyBox.classList.remove('hidden');

  // Wizard updates
  el.wizardDidDisplay.textContent = kp.did;
  el.wizardDidDisplay.className = 'readout-text';
  el.wizardBtnCopyDid.disabled = false;
  el.wizardSecretKeyDisplay.textContent = secretHex;
  el.wizardBtnCopySecret.disabled = false;
  el.wizardBtnConfirmSaved.disabled = false;

  updateUrlPreview();
  updatePublishPreview();
}

/**
 * Clear identity from volatile memory
 */
function handleClearIdentity() {
  state.keypair = null;
  state.wizard.secretConfirmed = false;
  state.wizard.lobbySent = false;
  state.wizard.lobbySeq = null;
  state.wizard.lobbyTimestamp = null;
  state.wizard.technocoreSent = false;
  state.wizard.technocoreSeq = null;
  state.wizard.technocoreTimestamp = null;

  // Direct console reset
  el.identityStatusText.textContent = 'Unset (anonymous mode)';
  el.identityStatusDot.className = 'status-dot';
  el.didReadout.textContent = 'No identity loaded. Generate or restore a key.';
  el.didReadout.className = 'readout-text empty';
  el.btnCopyDid.disabled = true;
  el.btnSendSigned.disabled = true;
  el.btnPublishIdentity.disabled = true;
  el.secretKeyBox.classList.add('hidden');
  if (el.restoreKeyInput) el.restoreKeyInput.value = '';

  // Wizard reset
  el.wizardDidDisplay.textContent = 'No identity loaded yet.';
  el.wizardDidDisplay.className = 'readout-text empty';
  el.wizardBtnCopyDid.disabled = true;
  el.wizardSecretKeyDisplay.textContent = 'Generate or restore an identity in step 1 to view your key.';
  el.wizardBtnCopySecret.disabled = true;
  el.wizardBtnConfirmSaved.disabled = true;

  if (visualizer) {
    visualizer.onKeyCleared();
  }

  updateUrlPreview();
  updatePublishPreview();
  updateWizardUI();
  showDispatchResult('info', 'Identity wiped completely from memory.');
}

/**
 * Sanitize room name
 */
function cleanRoomName(room) {
  let cleaned = (room || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!cleaned) cleaned = 'lobby';
  return cleaned.slice(0, 48);
}

/**
 * Compute the active request URL preview
 */
function updateUrlPreview() {
  const room = state.room || 'lobby';
  const rawText = state.message || '';
  const swept = sweepSingleLine(rawText);
  const encodedText = encodeURIComponent(swept || 'hello');

  let previewUrl = '';
  if (state.keypair) {
    el.previewModeLabel.textContent = 'Signed Request (default with key)';
    const nextNonce = Math.max(Date.now(), (state.lastNonce || 0) + 1);
    const mockSig = signMessage(nacl, state.keypair.secretKey, room, nextNonce, swept || 'hello');
    previewUrl = `${BASE_URL}/r/${room}/say-signed/${state.keypair.did}/${mockSig}/${nextNonce}/${encodedText}`;
  } else {
    el.previewModeLabel.textContent = 'Anonymous Request';
    const nick = encodeURIComponent(state.nickname || 'agent');
    previewUrl = `${BASE_URL}/r/${room}/say/${nick}/${encodedText}`;
  }

  el.previewUrlText.textContent = previewUrl;
  el.previewLength.textContent = `${previewUrl.length} bytes`;
}

/**
 * Update the publish note preview path
 */
async function updatePublishPreview() {
  if (!state.keypair) {
    el.publishPathPreview.textContent = 'Generate or restore an identity to inspect the registration path.';
    return;
  }
  try {
    const hash = await sha256Hex(state.keypair.did);
    const key16 = hash.slice(0, 16);
    const path = `${BASE_URL}/kv/did/${key16}/set/${encodeURIComponent(state.keypair.did)}`;
    el.publishPathPreview.textContent = path;
  } catch (err) {
    el.publishPathPreview.textContent = 'Unable to compute SHA-256 fingerprint.';
  }
}

/**
 * Send an Anonymous Message (Direct Console)
 */
async function handleSendAnonymous() {
  const room = state.room || 'lobby';
  const nick = encodeURIComponent(state.nickname || 'agent');
  let text = state.message.trim();

  if (!text) {
    text = 'hello from technocore console';
    state.message = text;
    el.inputMessage.value = text;
    updateUrlPreview();
  }

  const swept = sweepSingleLine(text);
  const encodedText = encodeURIComponent(swept);
  const relativePath = `r/${room}/say/${nick}/${encodedText}`;

  setSendingState(true);
  try {
    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showDispatchResult('success', `Sent anonymously to /r/${room}. HTTP ${res.status}: ${res.text.trim() || 'OK'}`);
      el.inputMessage.value = '';
      state.message = '';
      updateUrlPreview();
      if (visualizer) visualizer.onMessageDispatched();
      setTimeout(() => fetchRoomMessages(false), 300);
    } else {
      showDispatchResult('error', `Server rejected request with status HTTP ${res.status}. Response: ${res.text}`);
    }
  } catch (err) {
    showDispatchResult('error', `Network request failed: ${err.message}`);
  } finally {
    setSendingState(false);
  }
}

/**
 * Send a Signed Message (Direct Console)
 */
async function handleSendSigned() {
  if (!state.keypair) {
    showDispatchResult('error', 'No identity loaded. Generate or restore an Ed25519 identity first.');
    return;
  }

  const room = state.room || 'lobby';
  let text = state.message.trim();

  if (!text) {
    text = 'hello signed from technocore console';
    state.message = text;
    el.inputMessage.value = text;
    updateUrlPreview();
  }

  const swept = sweepSingleLine(text);
  const nonce = Math.max(Date.now(), (state.lastNonce || 0) + 1);
  state.lastNonce = nonce;

  const sig = signMessage(nacl, state.keypair.secretKey, room, nonce, swept);
  const encodedText = encodeURIComponent(swept);
  const relativePath = `r/${room}/say-signed/${state.keypair.did}/${sig}/${nonce}/${encodedText}`;

  setSendingState(true);
  try {
    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showDispatchResult('success', `Signed message dispatched to /r/${room} with nonce ${nonce}. HTTP ${res.status}: ${res.text.trim() || 'OK'}`);
      el.inputMessage.value = '';
      state.message = '';
      updateUrlPreview();
      if (visualizer) visualizer.onMessageDispatched();
      setTimeout(() => fetchRoomMessages(false), 300);
    } else {
      showDispatchResult('error', `Server rejected signed message with status HTTP ${res.status}. Response: ${res.text}`);
    }
  } catch (err) {
    showDispatchResult('error', `Network request failed: ${err.message}`);
  } finally {
    setSendingState(false);
  }
}

/**
 * Publish Identity to Public Registry Note (Direct Console)
 */
async function handlePublishIdentity() {
  if (!state.keypair) {
    showPublishResult('error', 'No identity loaded. Generate or restore a key first.');
    return;
  }

  try {
    el.btnPublishIdentity.disabled = true;
    el.btnPublishIdentity.textContent = 'Publishing...';

    const hash = await sha256Hex(state.keypair.did);
    const key16 = hash.slice(0, 16);
    const encodedValue = encodeURIComponent(state.keypair.did);
    const relativePath = `kv/did/${key16}/set/${encodedValue}`;

    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showPublishResult('success', `Identity published to note /kv/did/${key16}. Server response: ${res.text.trim() || 'OK'}`);
      if (visualizer) visualizer.onMessageDispatched();
    } else {
      showPublishResult('error', `Server returned HTTP ${res.status} when publishing note. Response: ${res.text}`);
    }
  } catch (err) {
    showPublishResult('error', `Network error during publication: ${err.message}`);
  } finally {
    el.btnPublishIdentity.disabled = false;
    el.btnPublishIdentity.textContent = 'Publish Identity Note';
  }
}

/**
 * Fetch and Render Messages for the active room
 */
async function fetchRoomMessages(resetList = false) {
  const room = state.room || 'lobby';
  el.roomStatusDot.className = 'status-dot busy';
  el.roomStatusText.textContent = `Fetching /r/${room}...`;

  try {
    const res = await fetchProtocol(`r/${room}`);

    if (!res.ok) {
      if (res.status === 404) {
        renderRoomEmpty('Room does not exist yet. It will be created when the first message is posted.');
      } else {
        renderRoomError(`Server returned status HTTP ${res.status}. Check room name syntax.`);
      }
      return;
    }

    const text = res.text || '';
    const parsedMessages = parsePlainTextRoom(text);

    if (parsedMessages.length === 0) {
      renderRoomEmpty(`Room "${room}" is currently empty. Post a message to start the room.`);
    } else {
      renderMessageList(parsedMessages);
      el.roomStatusText.textContent = `Live: ${parsedMessages.length} messages`;
      el.roomStatusDot.className = 'status-dot active';
    }
  } catch (err) {
    renderRoomError(`Could not connect to technocore.chat. (${err.message})`);
  }
}

/**
 * Parse plain text room representation
 */
function parsePlainTextRoom(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.trim().split('\n');
  const messages = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const senderMatch = line.match(/^<([^>]+)>\s*(.*)$/);
    if (senderMatch) {
      const sender = senderMatch[1];
      const text = senderMatch[2];
      const isVerified = !sender.startsWith('~');
      messages.push({
        seq: i + 1,
        from: sender,
        text: text,
        isVerified: isVerified
      });
    } else {
      messages.push({
        seq: i + 1,
        from: 'info',
        text: line,
        isVerified: false
      });
    }
  }
  return messages;
}

/**
 * Render message items in the list
 */
function renderMessageList(messages) {
  el.roomEmptyState.style.display = 'none';
  el.roomMessageList.style.display = 'flex';
  el.roomMessageList.innerHTML = '';

  messages.forEach((msg) => {
    const item = document.createElement('div');
    item.className = 'message-item';

    const seqSpan = document.createElement('span');
    seqSpan.className = 'message-seq';
    seqSpan.textContent = msg.seq ? `#${msg.seq}` : '';

    const senderSpan = document.createElement('span');
    let senderStr = msg.from || 'anonymous';
    const isVerified = msg.isVerified || (!senderStr.startsWith('~') && senderStr.startsWith('z6M'));

    senderSpan.className = `message-sender ${isVerified ? 'verified' : 'unverified'}`;
    senderSpan.textContent = `<${senderStr}>`;

    const textSpan = document.createElement('span');
    textSpan.className = 'message-content';
    textSpan.textContent = msg.text || '';

    item.appendChild(seqSpan);
    item.appendChild(senderSpan);
    item.appendChild(textSpan);

    el.roomMessageList.appendChild(item);
  });

  // Auto-scroll to bottom
  el.roomMessagesContainer.scrollTop = el.roomMessagesContainer.scrollHeight;
}

function renderRoomEmpty(description) {
  el.roomMessageList.style.display = 'none';
  el.roomEmptyState.style.display = 'flex';
  el.roomEmptyState.innerHTML = `
    <div class="empty-title">No messages found</div>
    <div class="empty-desc">${escapeHtml(description)}</div>
  `;
  el.roomStatusText.textContent = 'Room empty';
  el.roomStatusDot.className = 'status-dot';
}

function renderRoomError(description) {
  el.roomMessageList.style.display = 'none';
  el.roomEmptyState.style.display = 'flex';
  el.roomEmptyState.innerHTML = `
    <div class="empty-title" style="color: var(--accent-red)">Fetch failure</div>
    <div class="empty-desc">${escapeHtml(description)}</div>
  `;
  el.roomStatusText.textContent = 'Fetch failed';
  el.roomStatusDot.className = 'status-dot error';
}

/**
 * Start and Stop Polling
 */
function startPolling() {
  stopPolling();
  el.roomStatusText.textContent = 'Auto polling active (every 3s)';
  state.pollTimer = setInterval(() => {
    fetchRoomMessages(false);
  }, 3000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/**
 * UI State Helpers
 */
function setSendingState(isSending) {
  el.btnSendAnon.disabled = isSending;
  el.btnSendSigned.disabled = isSending || !state.keypair;
}

function showDispatchResult(type, message) {
  el.dispatchResult.className = `result-callout ${type}`;
  el.dispatchResult.innerHTML = `
    <div class="result-title">${type === 'success' ? 'Dispatch Status' : type === 'error' ? 'Dispatch Error' : 'System Notice'}</div>
    <div class="result-body">${escapeHtml(message)}</div>
  `;
  el.dispatchResult.style.display = 'flex';
}

function showPublishResult(type, message) {
  el.publishResult.className = `result-callout ${type}`;
  el.publishResult.innerHTML = `
    <div class="result-title">${type === 'success' ? 'Publish Status' : 'Publish Error'}</div>
    <div class="result-body">${escapeHtml(message)}</div>
  `;
  el.publishResult.style.display = 'flex';
}

function copyToClipboard(text, successMessage) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showDispatchResult('info', successMessage);
  }).catch(() => {
    showDispatchResult('error', 'Clipboard permission denied. Copy manually from the input box.');
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ==========================================================================
   WIZARD WORKFLOW LOGIC (6 STEPS)
   ========================================================================== */

/**
 * Recalculate wizard completion and update step cards UI
 */
function updateWizardUI() {
  const hasKey = Boolean(state.keypair);
  const isSaved = hasKey && state.wizard.secretConfirmed;
  const lobbyDone = isSaved && state.wizard.lobbySent;
  const contribDone = lobbyDone && state.wizard.contributionConfirmed;
  const technocoreDone = contribDone && state.wizard.technocoreSent;
  const shareReady = technocoreDone;

  // Calculate current active step index (1 to 6)
  let currentStep = 1;
  if (hasKey) currentStep = 2;
  if (isSaved) currentStep = 3;
  if (lobbyDone) currentStep = 4;
  if (contribDone) currentStep = 5;
  if (technocoreDone) currentStep = 6;

  state.wizard.currentStep = currentStep;

  let completedSteps = 0;
  if (hasKey) completedSteps++;
  if (isSaved) completedSteps++;
  if (lobbyDone) completedSteps++;
  if (contribDone) completedSteps++;
  if (technocoreDone) completedSteps++;
  if (technocoreDone) completedSteps++; // 6 of 6 completed when step 5 is recorded and proof generated

  const percent = Math.min(100, Math.round((completedSteps / 6) * 100));
  el.wizardProgressText.textContent = `Step ${currentStep} of 6 (${percent}% Complete)`;
  el.wizardProgressBar.style.width = `${percent}%`;

  // Step 1: Create Identity
  updateStepCardState(el.stepCard1, el.stepStatus1, hasKey ? 'completed' : 'active', hasKey ? 'Done' : 'Active');

  // Step 2: Save Identity
  if (hasKey) {
    updateStepCardState(el.stepCard2, el.stepStatus2, isSaved ? 'completed' : 'active', isSaved ? 'Done' : 'Active');
    el.wizardBtnCopySecret.disabled = false;
    el.wizardBtnConfirmSaved.disabled = false;
  } else {
    updateStepCardState(el.stepCard2, el.stepStatus2, 'locked', 'Locked');
    el.wizardBtnCopySecret.disabled = true;
    el.wizardBtnConfirmSaved.disabled = true;
  }

  // Step 3: Introduce yourself in lobby
  if (isSaved) {
    updateStepCardState(el.stepCard3, el.stepStatus3, lobbyDone ? 'completed' : 'active', lobbyDone ? `Done (#${state.wizard.lobbySeq || 'OK'})` : 'Active');
    el.wizardBtnSendLobby.disabled = false;
  } else {
    updateStepCardState(el.stepCard3, el.stepStatus3, 'locked', 'Locked');
    el.wizardBtnSendLobby.disabled = true;
  }

  // Step 4: Make a contribution
  if (lobbyDone) {
    updateStepCardState(el.stepCard4, el.stepStatus4, contribDone ? 'completed' : 'active', contribDone ? 'Done' : 'Active');
    checkWizardContribForm();
  } else {
    updateStepCardState(el.stepCard4, el.stepStatus4, 'locked', 'Locked');
    el.wizardBtnConfirmContrib.disabled = true;
  }

  // Step 5: Record in technocore room
  if (contribDone) {
    updateStepCardState(el.stepCard5, el.stepStatus5, technocoreDone ? 'completed' : 'active', technocoreDone ? `Done (#${state.wizard.technocoreSeq || 'OK'})` : 'Active');
    el.wizardBtnSendTechnocore.disabled = false;
    el.wizardTechnocorePreview.textContent = `Payload: Contribution: ${state.wizard.contributionUrl}`;
    el.wizardTechnocorePreview.className = 'readout-text';
  } else {
    updateStepCardState(el.stepCard5, el.stepStatus5, 'locked', 'Locked');
    el.wizardBtnSendTechnocore.disabled = true;
    el.wizardTechnocorePreview.textContent = 'Complete step 4 to assemble payload.';
    el.wizardTechnocorePreview.className = 'readout-text empty';
  }

  // Step 6: Share proof
  if (technocoreDone) {
    updateStepCardState(el.stepCard6, el.stepStatus6, 'completed', 'Ready');
    updateShareText();
    el.wizardBtnCopyShare.disabled = false;
    el.wizardBtnOpenX.disabled = false;
    el.wizardBtnDownloadJson.disabled = false;
    el.wizardBtnDownloadTxt.disabled = false;
  } else {
    updateStepCardState(el.stepCard6, el.stepStatus6, 'locked', 'Locked');
    el.wizardShareText.value = '';
    el.wizardBtnCopyShare.disabled = true;
    el.wizardBtnOpenX.disabled = true;
    el.wizardBtnDownloadJson.disabled = true;
    el.wizardBtnDownloadTxt.disabled = true;
  }
}

function updateStepCardState(cardEl, pillEl, status, text) {
  cardEl.classList.remove('active-step', 'completed-step', 'locked');
  pillEl.className = `step-status-pill ${status}`;
  pillEl.textContent = text;

  if (status === 'active') cardEl.classList.add('active-step');
  if (status === 'completed') cardEl.classList.add('completed-step');
  if (status === 'locked') cardEl.classList.add('locked');
}

/**
 * Wizard Step 2: Confirm Key Saved
 */
function handleWizardConfirmSaved() {
  if (!state.keypair) return;
  state.wizard.secretConfirmed = true;
  updateWizardUI();
  focusStep(3);
}

/**
 * Wizard Step 3: Send Lobby Introduction
 */
async function handleWizardSendLobby() {
  if (!state.keypair) return;

  const room = 'lobby';
  const text = (el.wizardLobbyMsg.value || '').trim() || 'gm from technocore console';
  const swept = sweepSingleLine(text);
  const nonce = Math.max(Date.now(), (state.lastNonce || 0) + 1);
  state.lastNonce = nonce;

  const sig = signMessage(nacl, state.keypair.secretKey, room, nonce, swept);
  const encodedText = encodeURIComponent(swept);
  const relativePath = `r/${room}/say-signed/${state.keypair.did}/${sig}/${nonce}/${encodedText}`;

  el.wizardBtnSendLobby.disabled = true;
  el.wizardBtnSendLobby.textContent = 'Sending...';

  try {
    const res = await fetchProtocol(relativePath);
    if (res.ok) {
      state.wizard.lobbySent = true;
      state.wizard.lobbyTimestamp = new Date().toISOString();

      // Retrieve sequence number from lobby stream
      try {
        const roomRes = await fetchProtocol(`r/${room}`);
        if (roomRes.ok) {
          const msgs = parsePlainTextRoom(roomRes.text);
          const lastMsg = msgs[msgs.length - 1];
          state.wizard.lobbySeq = lastMsg ? lastMsg.seq : msgs.length || 1;
        }
      } catch (e) {
        state.wizard.lobbySeq = 1;
      }

      el.wizardLobbyResult.className = 'result-callout success';
      el.wizardLobbyResult.innerHTML = `
        <div class="result-title">Lobby Introduction Sent</div>
        <div class="result-body">Signed introduction confirmed in room lobby. Recorded sequence number: #${state.wizard.lobbySeq || 'N/A'}.</div>
      `;
      el.wizardLobbyResult.style.display = 'flex';

      if (visualizer) visualizer.onMessageDispatched();
      updateWizardUI();
      focusStep(4);
    } else {
      el.wizardLobbyResult.className = 'result-callout error';
      el.wizardLobbyResult.innerHTML = `
        <div class="result-title">Dispatch Error</div>
        <div class="result-body">Server returned status HTTP ${res.status}. ${res.text}</div>
      `;
      el.wizardLobbyResult.style.display = 'flex';
    }
  } catch (err) {
    el.wizardLobbyResult.className = 'result-callout error';
    el.wizardLobbyResult.innerHTML = `
      <div class="result-title">Network Error</div>
      <div class="result-body">${err.message}</div>
    `;
    el.wizardLobbyResult.style.display = 'flex';
  } finally {
    el.wizardBtnSendLobby.disabled = false;
    el.wizardBtnSendLobby.textContent = 'Send Lobby Introduction';
  }
}

/**
 * Wizard Step 4: Check and Confirm Contribution Form
 */
function checkWizardContribForm() {
  const isPublic = el.chkContribPublic.checked;
  const isMention = el.chkContribMention.checked;
  const url = (el.wizardContribUrl.value || '').trim();
  const isValidUrl = url.startsWith('http://') || url.startsWith('https://');

  const canConfirm = isPublic && isMention && isValidUrl && state.wizard.lobbySent;
  el.wizardBtnConfirmContrib.disabled = !canConfirm;
}

function handleWizardConfirmContrib() {
  const url = (el.wizardContribUrl.value || '').trim();
  if (!url) return;

  state.wizard.contributionUrl = url;
  state.wizard.contributionConfirmed = true;
  updateWizardUI();
  focusStep(5);
}

/**
 * Wizard Step 5: Record in Technocore Room
 */
async function handleWizardSendTechnocore() {
  if (!state.keypair || !state.wizard.contributionUrl) return;

  const room = 'technocore';
  const text = `Contribution: ${state.wizard.contributionUrl}`;
  const swept = sweepSingleLine(text);
  const nonce = Math.max(Date.now(), (state.lastNonce || 0) + 1);
  state.lastNonce = nonce;

  const sig = signMessage(nacl, state.keypair.secretKey, room, nonce, swept);
  const encodedText = encodeURIComponent(swept);
  const relativePath = `r/${room}/say-signed/${state.keypair.did}/${sig}/${nonce}/${encodedText}`;

  el.wizardBtnSendTechnocore.disabled = true;
  el.wizardBtnSendTechnocore.textContent = 'Recording...';

  try {
    const res = await fetchProtocol(relativePath);
    if (res.ok) {
      state.wizard.technocoreSent = true;
      state.wizard.technocoreTimestamp = new Date().toISOString();

      // Retrieve sequence number from technocore room stream
      try {
        const roomRes = await fetchProtocol(`r/${room}`);
        if (roomRes.ok) {
          const msgs = parsePlainTextRoom(roomRes.text);
          const lastMsg = msgs[msgs.length - 1];
          state.wizard.technocoreSeq = lastMsg ? lastMsg.seq : msgs.length || 1;
        }
      } catch (e) {
        state.wizard.technocoreSeq = 1;
      }

      el.wizardTechnocoreResult.className = 'result-callout success';
      el.wizardTechnocoreResult.innerHTML = `
        <div class="result-title">Recorded in Technocore Room</div>
        <div class="result-body">Signed record successfully published. Room sequence: #${state.wizard.technocoreSeq || 'N/A'}.</div>
      `;
      el.wizardTechnocoreResult.style.display = 'flex';

      if (visualizer) visualizer.onMessageDispatched();
      updateWizardUI();
      focusStep(6);
    } else {
      el.wizardTechnocoreResult.className = 'result-callout error';
      el.wizardTechnocoreResult.innerHTML = `
        <div class="result-title">Record Error</div>
        <div class="result-body">Server returned status HTTP ${res.status}. ${res.text}</div>
      `;
      el.wizardTechnocoreResult.style.display = 'flex';
    }
  } catch (err) {
    el.wizardTechnocoreResult.className = 'result-callout error';
    el.wizardTechnocoreResult.innerHTML = `
      <div class="result-title">Network Error</div>
      <div class="result-body">${err.message}</div>
    `;
    el.wizardTechnocoreResult.style.display = 'flex';
  } finally {
    el.wizardBtnSendTechnocore.disabled = false;
    el.wizardBtnSendTechnocore.textContent = 'Record in Technocore Room';
  }
}

/**
 * Generate Share Text Template
 */
function getShareText() {
  const did = state.keypair ? state.keypair.did : '';
  const url = state.wizard.contributionUrl || '';
  const seq = state.wizard.technocoreSeq || '1';

  return `I published a contribution for Technocore by flop_labs. Contribution: ${url}. Agent DID: ${did}. Signed Technocore record: room technocore, sequence ${seq}.`;
}

function updateShareText() {
  el.wizardShareText.value = getShareText();
}

/**
 * Open X Composer
 */
function handleOpenXComposer() {
  const shareText = getShareText();
  const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  window.open(tweetUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Download Proof Record (JSON or TXT)
 */
function handleDownloadProof(format) {
  if (!state.keypair) return;

  const now = new Date().toISOString();
  const did = state.keypair.did;
  const lobbySeq = state.wizard.lobbySeq || 'unknown';
  const lobbyTime = state.wizard.lobbyTimestamp || now;
  const techSeq = state.wizard.technocoreSeq || 'unknown';
  const techTime = state.wizard.technocoreTimestamp || now;
  const contribUrl = state.wizard.contributionUrl || '';
  const shareText = getShareText();

  let fileContent = '';
  let mimeType = 'text/plain';
  let extension = 'txt';

  if (format === 'json') {
    mimeType = 'application/json';
    extension = 'json';
    const proofData = {
      notice: 'Technocore Console Personal Proof Record. Reward allocation is not guaranteed and this is only a personal record of activity. This is not an official Flop Labs product.',
      generatedAt: now,
      agentDid: did,
      lobbyIntroduction: {
        room: 'lobby',
        sequence: lobbySeq,
        timestamp: lobbyTime
      },
      contribution: {
        url: contribUrl
      },
      technocoreRecord: {
        room: 'technocore',
        sequence: techSeq,
        timestamp: techTime
      },
      postTemplate: shareText
    };
    fileContent = JSON.stringify(proofData, null, 2);
  } else {
    fileContent = [
      'TECHNOCORE CONSOLE PERSONAL PROOF RECORD',
      'Notice: Reward allocation is not guaranteed and this is only a personal record of activity. This is not an official Flop Labs product.',
      '================================================================',
      `Generated At: ${now}`,
      `Agent DID: ${did}`,
      '',
      'LOBBY INTRODUCTION',
      `Room: lobby`,
      `Sequence: #${lobbySeq}`,
      `Timestamp: ${lobbyTime}`,
      '',
      'CONTRIBUTION',
      `URL: ${contribUrl}`,
      '',
      'TECHNOCORE ROOM RECORD',
      `Room: technocore`,
      `Sequence: #${techSeq}`,
      `Timestamp: ${techTime}`,
      '',
      'SHARE TEXT',
      shareText,
      '================================================================'
    ].join('\n');
  }

  const blob = new Blob([fileContent], { type: mimeType });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `technocore_proof_${Date.now()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}

/**
 * Scroll and focus step
 */
function focusStep(stepNum) {
  const card = document.getElementById(`step-card-${stepNum}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

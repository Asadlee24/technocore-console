/**
 * Technocore Console V4 - Application Core Logic
 * Made by Asad Lee (Community-built client, not an official FLOP Labs product)
 * Client-side control panel, Secret Shape Guard, offline verifier, and Sonnet Challenge Console.
 *
 * Strict Authoritative Invariants:
 * 1. HTTP transport success (200) NEVER locks contest role or marks eligibility.
 * 2. Never invent version, room generation, previous_state_hash, or poem_sha256.
 * 3. Never use Date.now() as Technocore sequence.
 * 4. Actions are strictly gated by prerequisite verified referee receipts.
 */

import {
  generateKeypair,
  restoreKeypair,
  deriveDidKey,
  signMessage,
  bytesToHex,
  sha256Hex,
  verifyMessageSignature,
  signMemory,
  verifyMemorySignature
} from './crypto.js';

import {
  sweepSingleLine,
  cleanRoomName,
  deriveRegistryPath,
  deriveLegacyRegistryPath,
  formatCanonicalPoem,
  calculatePoemSha256,
  validateIdentifier
} from './protocol.js';

import {
  detectSensitiveContent,
  redactSecret,
  wipeBuffer
} from './security.js';

import { nonceManager } from './nonce.js';

import {
  fetchProtocol,
  dispatchSignedMessage,
  dispatchAnonymousMessage,
  RoomPoller
} from './transport.js';

import { receiptEngine } from './receipt.js';
import { SONNET_CONFIG, getPinnedReferee, setPinnedReferee, isRefereePinned, extractAndPinRefereeFromRules } from './contest-config.js';

import {
  loadFrozenLexicon,
  validateCandidateWord,
  validatePoemSyllables,
  buildSonnetRegisterPayload,
  buildSonnetTeamRequestPayload,
  buildSonnetRosterPayload,
  buildSonnetWithdrawPayload,
  buildSonnetWordPayload,
  buildSonnetSubmitPayload,
  buildSonnetBallotPayload,
  buildSonnetClaimPayload
} from './sonnet.js';

import { CryptoVisualizer } from './visualizer3d.js';

// Base protocol URL
const BASE_URL = 'https://technocore.chat';

// Volatile in-memory application state
const state = {
  keypair: null, // { secretKey, publicKey, seed, did }
  room: 'lobby',
  nickname: 'agent_' + Math.floor(1000 + Math.random() * 9000),
  message: '',
  isPolling: false,
  roomPoller: null,
  messages: [],
  theme: 'dark',
  activeView: 'wizard',

  // Secret visibility controls
  secretsRevealed: {
    wizard: false,
    direct: false
  },

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
  },

  // Memory Vault state (in-memory only, never persisted)
  vault: {
    memories: [],
    verifiedCount: 0
  },

  // Sonnet Challenge state (Authoritative State Machine)
  sonnet: {
    contestId: SONNET_CONFIG.defaultContestId,
    role: 'writer',
    xAccountUrl: '',
    requestIdCounter: 1,

    // Authoritative referee registration state (never set from HTTP 200)
    registrationPending: false,
    registrationAccepted: false,
    roleLocked: false,
    lastRegistrationReqId: null,

    // Authoritative team & room state
    gameId: '',
    teamRequestPending: false,
    teamRequestAccepted: false,
    lastTeamReqId: null,
    allocatedPoemRoom: null, // strictly null until referee receipt
    roomGeneration: null,    // strictly null until referee receipt

    // Authoritative roster state
    rosterMembers: [],
    rosterAccepted: false,
    rosterFrozen: false,
    lastRosterReqId: null,

    // Authoritative poem state (from referee receipts only)
    currentVersion: null,     // strictly null until referee receipt
    previousStateHash: null,  // strictly null until referee receipt
    lastContributor: null,
    lastWordReqId: null,
    acceptedWordVersions: new Map(), // key -> { version, word }
    words: [],               // strictly words accepted by referee
    poemSha256: null,        // computed only when poem is 14 lines x 10 syllables

    // Authoritative submission & ballot state
    submissionPending: false,
    submissionAccepted: false,
    lastSubmitReqId: null,
    submittedEntryId: null,
    xPostIds: [],

    ballotPending: false,
    ballotAccepted: false,
    lastBallotReqId: null,

    prizeAuthorized: false,
    claimPending: false,
    claimAccepted: false,
    lastClaimReqId: null,

    lexiconLoaded: false
  }
};

// UI Elements Map
let el = {};
let visualizer = null;
const activeSonnetPollers = new Map();

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
  initSonnet();
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
    tabSonnetMode: document.getElementById('tab-sonnet-mode'),
    tabVerifierMode: document.getElementById('tab-verifier-mode'),
    tabVaultMode: document.getElementById('tab-vault-mode'),
    wizardView: document.getElementById('wizard-view'),
    directView: document.getElementById('direct-view'),
    sonnetView: document.getElementById('sonnet-view'),
    verifierView: document.getElementById('verifier-view'),
    vaultView: document.getElementById('vault-view'),
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
    wizardBtnRevealSecret: document.getElementById('wizard-btn-reveal-secret'),
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
    btnRevealSecretKey: document.getElementById('btn-reveal-secret-key'),
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
    publishPathPreview: document.getElementById('publish-path-preview'),

    // Offline Signature Verifier Elements
    verifyQuickInput: document.getElementById('verify-quick-input'),
    btnQuickParse: document.getElementById('btn-quick-parse'),
    verifyDidInput: document.getElementById('verify-did-input'),
    verifyRoomInput: document.getElementById('verify-room-input'),
    verifySigInput: document.getElementById('verify-sig-input'),
    verifyNonceInput: document.getElementById('verify-nonce-input'),
    verifyMsgInput: document.getElementById('verify-msg-input'),
    btnRunVerify: document.getElementById('btn-run-verify'),
    btnClearVerify: document.getElementById('btn-clear-verify'),
    verifyResultBox: document.getElementById('verify-result-box'),

    // Memory Vault Elements
    vaultStatTotal: document.getElementById('vault-stat-total'),
    vaultStatVerified: document.getElementById('vault-stat-verified'),
    vaultStatLast: document.getElementById('vault-stat-last'),
    vaultIdentityDot: document.getElementById('vault-identity-dot'),
    vaultIdentityLabel: document.getElementById('vault-identity-label'),
    vaultCategorySelect: document.getElementById('vault-category-select'),
    vaultMemoryText: document.getElementById('vault-memory-text'),
    vaultNotePathPreview: document.getElementById('vault-note-path-preview'),
    btnVaultSave: document.getElementById('btn-vault-save'),
    vaultSaveResult: document.getElementById('vault-save-result'),
    vaultTimelineList: document.getElementById('vault-timeline-list'),
    btnVaultExport: document.getElementById('btn-vault-export'),
    vaultRestoreDidInput: document.getElementById('vault-restore-did-input'),
    btnVaultRestoreDid: document.getElementById('btn-vault-restore-did'),
    vaultImportFile: document.getElementById('vault-import-file'),
    btnVaultImport: document.getElementById('btn-vault-import'),
    vaultRestoreResult: document.getElementById('vault-restore-result'),

    // Sonnet Challenge Elements
    sonnetStatRole: document.getElementById('sonnet-stat-role'),
    sonnetStatGame: document.getElementById('sonnet-stat-game'),
    sonnetStatVersion: document.getElementById('sonnet-stat-version'),
    sonnetStatSyllables: document.getElementById('sonnet-stat-syllables'),
    sonnetInfoContestId: document.getElementById('sonnet-info-contest-id'),
    sonnetInfoDictHash: document.getElementById('sonnet-info-dict-hash'),
    sonnetInfoRefereeDid: document.getElementById('sonnet-info-referee-did'),
    sonnetEligibilityBadge: document.getElementById('sonnet-eligibility-badge'),
    sonnetActiveDidReadout: document.getElementById('sonnet-active-did-readout'),
    sonnetBtnCopyDid: document.getElementById('sonnet-btn-copy-did'),
    sonnetProofRole: document.getElementById('sonnet-proof-role'),
    sonnetProofEvidence: document.getElementById('sonnet-proof-evidence'),
    sonnetProofSeq: document.getElementById('sonnet-proof-seq'),
    sonnetProofSigState: document.getElementById('sonnet-proof-sig-state'),
    sonnetRegLockBadge: document.getElementById('sonnet-reg-lock-badge'),
    sonnetRegRoleSelect: document.getElementById('sonnet-reg-role-select'),
    sonnetRegRequestId: document.getElementById('sonnet-reg-request-id'),
    sonnetRegXGroup: document.getElementById('sonnet-reg-x-group'),
    sonnetRegXUrl: document.getElementById('sonnet-reg-x-url'),
    sonnetRegPayloadPreview: document.getElementById('sonnet-reg-payload-preview'),
    sonnetBtnSendRegister: document.getElementById('sonnet-btn-send-register'),
    sonnetRegResult: document.getElementById('sonnet-reg-result'),
    sonnetTeamGameId: document.getElementById('sonnet-team-game-id'),
    sonnetTeamReqId: document.getElementById('sonnet-team-req-id'),
    sonnetAllocatedRoomDisplay: document.getElementById('sonnet-allocated-room-display'),
    sonnetTeamPayloadPreview: document.getElementById('sonnet-team-payload-preview'),
    sonnetBtnSendTeamReq: document.getElementById('sonnet-btn-send-team-req'),
    sonnetTeamReqResult: document.getElementById('sonnet-team-req-result'),
    sonnetRosterFreezeBadge: document.getElementById('sonnet-roster-freeze-badge'),
    sonnetRosterMembersInput: document.getElementById('sonnet-roster-members-input'),
    sonnetRosterPayloadPreview: document.getElementById('sonnet-roster-payload-preview'),
    sonnetBtnSignRoster: document.getElementById('sonnet-btn-sign-roster'),
    sonnetBtnWithdrawTeam: document.getElementById('sonnet-btn-withdraw-team'),
    sonnetRosterResult: document.getElementById('sonnet-roster-result'),
    sonnetWordInput: document.getElementById('sonnet-word-input'),
    sonnetBtnCheckWord: document.getElementById('sonnet-btn-check-word'),
    sonnetWordCheckResult: document.getElementById('sonnet-word-check-result'),
    sonnetReadoutGen: document.getElementById('sonnet-readout-gen'),
    sonnetReadoutVer: document.getElementById('sonnet-readout-ver'),
    sonnetReadoutLastAuthor: document.getElementById('sonnet-readout-last-author'),
    sonnetReadoutTurnEligibility: document.getElementById('sonnet-readout-turn-eligibility'),
    sonnetReadoutPrevHash: document.getElementById('sonnet-readout-prev-hash'),
    sonnetWordPayloadPreview: document.getElementById('sonnet-word-payload-preview'),
    sonnetBtnSendWord: document.getElementById('sonnet-btn-send-word'),
    sonnetWordResult: document.getElementById('sonnet-word-result'),
    sonnetPoemShaDisplay: document.getElementById('sonnet-poem-sha-display'),
    sonnetBtnCopyPoem: document.getElementById('sonnet-btn-copy-poem'),
    sonnetBtnCopyAttribution: document.getElementById('sonnet-btn-copy-attribution'),
    sonnetXPostIds: document.getElementById('sonnet-x-post-ids'),
    sonnetSubmitPayloadPreview: document.getElementById('sonnet-submit-payload-preview'),
    sonnetBtnSendSubmission: document.getElementById('sonnet-btn-send-submission'),
    sonnetSubmitResult: document.getElementById('sonnet-submit-result'),
    sonnetSubmittedEntryId: document.getElementById('sonnet-submitted-entry-id'),
    sonnetBallotEntryId: document.getElementById('sonnet-ballot-entry-id'),
    sonnetBallotReqId: document.getElementById('sonnet-ballot-req-id'),
    sonnetBallotPayloadPreview: document.getElementById('sonnet-ballot-payload-preview'),
    sonnetBtnSendBallot: document.getElementById('sonnet-btn-send-ballot'),
    sonnetBallotResult: document.getElementById('sonnet-ballot-result'),
    sonnetClaimDestination: document.getElementById('sonnet-claim-destination'),
    sonnetBtnSendClaim: document.getElementById('sonnet-btn-send-claim'),
    sonnetClaimResult: document.getElementById('sonnet-claim-result'),
    sonnetPoemStateBadge: document.getElementById('sonnet-poem-state-badge'),
    sonnetMeterSummary: document.getElementById('sonnet-meter-summary'),
    sonnetPoemLinesList: document.getElementById('sonnet-poem-lines-list'),
    sonnetCanonicalTextArea: document.getElementById('sonnet-canonical-text-area'),
    sonnetBtnClearReceipts: document.getElementById('sonnet-btn-clear-receipts'),
    sonnetReceiptsList: document.getElementById('sonnet-receipts-list')
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
 * Switch Navigation View
 */
function setView(viewName) {
  state.activeView = viewName;

  el.tabWizardMode.classList.toggle('active', viewName === 'wizard');
  el.tabWizardMode.setAttribute('aria-selected', String(viewName === 'wizard'));

  el.tabDirectMode.classList.toggle('active', viewName === 'direct');
  el.tabDirectMode.setAttribute('aria-selected', String(viewName === 'direct'));

  if (el.tabSonnetMode) {
    el.tabSonnetMode.classList.toggle('active', viewName === 'sonnet');
    el.tabSonnetMode.setAttribute('aria-selected', String(viewName === 'sonnet'));
  }

  el.tabVerifierMode.classList.toggle('active', viewName === 'verifier');
  el.tabVerifierMode.setAttribute('aria-selected', String(viewName === 'verifier'));

  el.tabVaultMode.classList.toggle('active', viewName === 'vault');
  el.tabVaultMode.setAttribute('aria-selected', String(viewName === 'vault'));

  el.wizardView.classList.toggle('hidden', viewName !== 'wizard');
  el.directView.classList.toggle('hidden', viewName !== 'direct');
  if (el.sonnetView) el.sonnetView.classList.toggle('hidden', viewName !== 'sonnet');
  el.verifierView.classList.toggle('hidden', viewName !== 'verifier');
  el.vaultView.classList.toggle('hidden', viewName !== 'vault');

  if (viewName === 'sonnet') {
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Event Bindings
 */
function bindEvents() {
  // Navigation tabs
  el.tabWizardMode.addEventListener('click', () => setView('wizard'));
  el.tabDirectMode.addEventListener('click', () => setView('direct'));
  if (el.tabSonnetMode) el.tabSonnetMode.addEventListener('click', () => setView('sonnet'));
  el.tabVerifierMode.addEventListener('click', () => setView('verifier'));
  el.tabVaultMode.addEventListener('click', () => setView('vault'));

  // Theme toggle
  el.themeToggle.addEventListener('click', toggleTheme);

  // Keypair Management (Direct Console)
  el.btnGenerateKey.addEventListener('click', handleGenerateKey);
  el.btnRestoreKey.addEventListener('click', () => handleRestoreKey(el.restoreKeyInput.value));
  el.btnClearIdentity.addEventListener('click', handleClearIdentity);
  el.btnCopyDid.addEventListener('click', () => copyToClipboard(state.keypair ? state.keypair.did : '', 'DID copied to clipboard.'));
  el.btnRevealSecretKey.addEventListener('click', () => toggleSecretReveal('direct'));
  el.btnCopySecretKey.addEventListener('click', () => {
    if (state.keypair) copyToClipboard(bytesToHex(state.keypair.secretKey), 'Secret key copied to clipboard.');
  });

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
  el.wizardBtnRevealSecret.addEventListener('click', () => toggleSecretReveal('wizard'));
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

  // Signature Verifier Bindings
  el.btnQuickParse.addEventListener('click', handleQuickParse);
  el.btnRunVerify.addEventListener('click', handleRunVerify);
  if (el.btnClearVerify) el.btnClearVerify.addEventListener('click', handleClearVerify);

  // Memory Vault Bindings
  el.btnVaultSave.addEventListener('click', handleVaultSave);
  el.btnVaultExport.addEventListener('click', handleVaultExport);
  el.btnVaultRestoreDid.addEventListener('click', handleVaultRestoreByDid);
  el.btnVaultImport.addEventListener('click', handleVaultImportFile);

  // Sonnet Challenge Bindings
  bindSonnetEvents();
}

/**
 * Toggle Secret Key Visibility (Hide / Reveal)
 */
const MASKED_KEY = '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••';

function toggleSecretReveal(view) {
  if (!state.keypair) return;
  state.secretsRevealed[view] = !state.secretsRevealed[view];
  const isRevealed = state.secretsRevealed[view];
  const realHex = bytesToHex(state.keypair.secretKey);

  if (view === 'wizard') {
    el.wizardSecretKeyDisplay.textContent = isRevealed ? realHex : MASKED_KEY;
    el.wizardBtnRevealSecret.textContent = isRevealed ? 'Hide Secret' : 'Reveal Secret';
  } else if (view === 'direct') {
    el.secretKeyValue.textContent = isRevealed ? realHex : MASKED_KEY;
    el.btnRevealSecretKey.textContent = isRevealed ? 'Hide Secret' : 'Reveal Secret';
  }
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
    state.wizard.secretConfirmed = false;

    applyKeypairToUI(kp);

    if (visualizer) {
      visualizer.onKeyGenerated(kp.did);
    }

    updateWizardUI();
    updateSonnetStateUI();
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
    state.wizard.secretConfirmed = true;

    applyKeypairToUI(kp);

    if (visualizer) {
      visualizer.onKeyGenerated(kp.did);
    }

    if (el.restoreKeyInput) el.restoreKeyInput.value = '';
    if (el.wizardRestoreInput) el.wizardRestoreInput.value = '';
    if (el.wizardRestoreBox) el.wizardRestoreBox.classList.add('hidden');

    updateWizardUI();
    updateSonnetStateUI();
    showDispatchResult('info', 'Identity successfully restored into browser memory.');
  } catch (err) {
    showDispatchResult('error', `Failed to restore key: ${err.message}`);
  }
}

/**
 * Apply active keypair to all views and inputs
 */
function applyKeypairToUI(kp) {
  state.secretsRevealed.wizard = false;
  state.secretsRevealed.direct = false;

  // Direct Console updates
  el.identityStatusText.textContent = 'Active (Ed25519 in memory)';
  el.identityStatusDot.className = 'status-dot active';
  el.didReadout.textContent = kp.did;
  el.didReadout.className = 'readout-text';
  el.btnCopyDid.disabled = false;
  el.btnSendSigned.disabled = false;
  el.btnPublishIdentity.disabled = false;

  el.secretKeyValue.textContent = MASKED_KEY;
  el.btnRevealSecretKey.textContent = 'Reveal Secret';
  el.secretKeyBox.classList.remove('hidden');

  // Wizard updates
  el.wizardDidDisplay.textContent = kp.did;
  el.wizardDidDisplay.className = 'readout-text';
  el.wizardBtnCopyDid.disabled = false;
  el.wizardSecretKeyDisplay.textContent = MASKED_KEY;
  el.wizardBtnRevealSecret.disabled = false;
  el.wizardBtnRevealSecret.textContent = 'Reveal Secret';
  el.wizardBtnCopySecret.disabled = false;
  el.wizardBtnConfirmSaved.disabled = false;

  // Memory Vault updates
  el.vaultIdentityDot.className = 'status-dot active';
  el.vaultIdentityLabel.textContent = kp.did.slice(0, 26) + '...';
  el.btnVaultSave.disabled = false;
  updateVaultNotePath();

  // Sonnet updates
  updateSonnetStateUI();
  updateUrlPreview();
  updatePublishPreview();
}

/**
 * Clear identity from volatile memory
 */
function handleClearIdentity() {
  if (state.keypair) {
    wipeBuffer(state.keypair.secretKey);
    wipeBuffer(state.keypair.publicKey);
    if (state.keypair.seed) wipeBuffer(state.keypair.seed);
  }

  state.keypair = null;
  state.secretsRevealed.wizard = false;
  state.secretsRevealed.direct = false;

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
  el.wizardBtnRevealSecret.disabled = true;
  el.wizardBtnCopySecret.disabled = true;
  el.wizardBtnConfirmSaved.disabled = true;

  if (visualizer) {
    visualizer.onKeyCleared();
  }

  updateUrlPreview();
  updatePublishPreview();
  updateWizardUI();
  updateSonnetStateUI();
  showDispatchResult('info', 'Identity wiped completely from transient memory.');
}

/**
 * Compute active request URL preview
 */
function updateUrlPreview() {
  const room = state.room || 'lobby';
  const rawText = state.message || '';
  const swept = sweepSingleLine(rawText);
  const encodedText = encodeURIComponent(swept || 'hello');

  let previewUrl = '';
  if (state.keypair) {
    el.previewModeLabel.textContent = 'Signed Request (POST / GET)';
    const nextNonce = nonceManager.nextNonce(state.keypair.did, room);
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
 * Update the publish note preview path using canonical sharded path
 */
async function updatePublishPreview() {
  if (!state.keypair) {
    el.publishPathPreview.textContent = 'Generate or restore an identity to inspect the registration path.';
    return;
  }
  try {
    const { fullPath, canonicalPath } = await deriveRegistryPath(state.keypair.did);
    const targetPath = fullPath || canonicalPath;
    el.publishPathPreview.textContent = `${BASE_URL}${targetPath}/set/${encodeURIComponent(state.keypair.did)}`;
  } catch (err) {
    el.publishPathPreview.textContent = 'Unable to compute canonical registry path.';
  }
}

/**
 * Send an Anonymous Message (Direct Console)
 * Protected by redesigned Secret Shape Guard
 */
async function handleSendAnonymous() {
  const room = state.room || 'lobby';
  const nick = state.nickname || 'agent';
  let text = state.message.trim();

  if (!text) {
    text = 'hello from technocore console';
    state.message = text;
    el.inputMessage.value = text;
    updateUrlPreview();
  }

  const guard = detectSensitiveContent(text);
  if (guard.sensitive) {
    showDispatchResult('error', guard.description || 'Sensitive content detected.');
    return;
  }

  setSendingState(true);
  try {
    const res = await dispatchAnonymousMessage(room, nick, text);

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
 * Transport: Signed POST with fallback to Signed GET
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

  const guard = detectSensitiveContent(text);
  if (guard.sensitive) {
    showDispatchResult('error', guard.description || 'Sensitive content detected.');
    return;
  }

  setSendingState(true);
  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, room, text);

    if (res.ok) {
      const laneStr = (res.lane || res.transport || 'POST').toUpperCase();
      showDispatchResult('success', `Signed message dispatched to /r/${room} via ${laneStr} (nonce ${res.nonce}). HTTP ${res.status}: ${res.text.trim() || 'OK'}`);
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
 * Publish Identity to Canonical Public Registry Note
 */
async function handlePublishIdentity() {
  if (!state.keypair) {
    showPublishResult('error', 'No identity loaded. Generate or restore a key first.');
    return;
  }

  try {
    el.btnPublishIdentity.disabled = true;
    el.btnPublishIdentity.textContent = 'Publishing...';

    const { fullPath, canonicalPath, shard, key } = await deriveRegistryPath(state.keypair.did);
    const targetPath = fullPath || canonicalPath;
    const encodedValue = encodeURIComponent(state.keypair.did);
    const relativePath = `${targetPath.replace(/^\//, '')}/set/${encodedValue}`;

    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showPublishResult('success', `Identity published to canonical path /kv/did-${shard}/${key}. Server response: ${res.text.trim() || 'OK'}`);
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
    const res = await fetchProtocol(`r/${room}?format=json`);

    if (!res.ok) {
      if (res.status === 404) {
        renderRoomEmpty('Room does not exist yet. It will be created when the first message is posted.');
      } else {
        renderRoomError(`Server returned status HTTP ${res.status}. Check room name syntax.`);
      }
      return;
    }

    const text = res.text || '';
    let parsedMessages = [];

    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        parsedMessages = data.map((item, idx) => ({
          seq: item.seq || idx + 1,
          from: item.did || item.from || item.nick || 'anonymous',
          text: item.text || item.msg || '',
          isVerified: Boolean(item.did || item.verified)
        }));
      } else if (data.messages && Array.isArray(data.messages)) {
        parsedMessages = data.messages.map((item, idx) => ({
          seq: item.seq || idx + 1,
          from: item.did || item.from || item.nick || 'anonymous',
          text: item.text || item.msg || '',
          isVerified: Boolean(item.did || item.verified)
        }));
      }
    } catch {
      parsedMessages = parsePlainTextRoom(text);
    }

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

function renderMessageList(messages) {
  el.roomEmptyState.style.display = 'none';
  el.roomMessageList.style.display = 'flex';
  el.roomMessageList.style.flexDirection = 'column';
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

function startPolling() {
  stopPolling();
  el.roomStatusText.textContent = 'Auto polling active (incremental)';
  state.roomPoller = new RoomPoller(state.room, {
    onMessages: (newMsgs) => {
      fetchRoomMessages(false);
    },
    onError: (err) => {
      el.roomStatusText.textContent = `Polling backoff: ${err.message}`;
    },
    onStatusChange: (status) => {
      if (status === 'connected') el.roomStatusDot.className = 'status-dot active';
      else if (status === 'backoff') el.roomStatusDot.className = 'status-dot busy';
    }
  });
  state.roomPoller.start();
}

function stopPolling() {
  if (state.roomPoller) {
    state.roomPoller.stop();
    state.roomPoller = null;
  }
}

function setSendingState(isSending) {
  el.btnSendAnon.disabled = isSending;
  el.btnSendSigned.disabled = isSending || !state.keypair;
}

function showDispatchResult(type, message) {
  el.dispatchResult.className = `result-callout ${type}`;
  el.dispatchResult.innerHTML = `
    <div class="result-title">${type === 'success' ? 'Dispatch Status' : type === 'error' ? 'Security Alert / Error' : 'System Notice'}</div>
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

function updateWizardUI() {
  const hasKey = Boolean(state.keypair);
  const isSaved = hasKey && state.wizard.secretConfirmed;
  const lobbyDone = isSaved && state.wizard.lobbySent;
  const contribDone = lobbyDone && state.wizard.contributionConfirmed;
  const technocoreDone = contribDone && state.wizard.technocoreSent;

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
  if (technocoreDone) completedSteps++;

  const percent = Math.min(100, Math.round((completedSteps / 6) * 100));
  el.wizardProgressText.textContent = `Step ${currentStep} of 6 (${percent}% Complete)`;
  el.wizardProgressBar.style.width = `${percent}%`;

  updateStepCardState(el.stepCard1, el.stepStatus1, hasKey ? 'completed' : 'active', hasKey ? 'Done' : 'Active');

  if (hasKey) {
    updateStepCardState(el.stepCard2, el.stepStatus2, isSaved ? 'completed' : 'active', isSaved ? 'Done' : 'Active');
    el.wizardBtnRevealSecret.disabled = false;
    el.wizardBtnCopySecret.disabled = false;
    el.wizardBtnConfirmSaved.disabled = false;
  } else {
    updateStepCardState(el.stepCard2, el.stepStatus2, 'locked', 'Locked');
    el.wizardBtnRevealSecret.disabled = true;
    el.wizardBtnCopySecret.disabled = true;
    el.wizardBtnConfirmSaved.disabled = true;
  }

  if (isSaved) {
    updateStepCardState(el.stepCard3, el.stepStatus3, lobbyDone ? 'completed' : 'active', lobbyDone ? `Done` : 'Active');
    el.wizardBtnSendLobby.disabled = false;
  } else {
    updateStepCardState(el.stepCard3, el.stepStatus3, 'locked', 'Locked');
    el.wizardBtnSendLobby.disabled = true;
  }

  if (lobbyDone) {
    updateStepCardState(el.stepCard4, el.stepStatus4, contribDone ? 'completed' : 'active', contribDone ? 'Done' : 'Active');
    checkWizardContribForm();
  } else {
    updateStepCardState(el.stepCard4, el.stepStatus4, 'locked', 'Locked');
    el.wizardBtnConfirmContrib.disabled = true;
  }

  if (contribDone) {
    updateStepCardState(el.stepCard5, el.stepStatus5, technocoreDone ? 'completed' : 'active', technocoreDone ? `Done` : 'Active');
    el.wizardBtnSendTechnocore.disabled = false;
    el.wizardTechnocorePreview.textContent = `Payload: Contribution: ${state.wizard.contributionUrl}`;
    el.wizardTechnocorePreview.className = 'readout-text';
  } else {
    updateStepCardState(el.stepCard5, el.stepStatus5, 'locked', 'Locked');
    el.wizardBtnSendTechnocore.disabled = true;
    el.wizardTechnocorePreview.textContent = 'Complete step 4 to assemble payload.';
    el.wizardTechnocorePreview.className = 'readout-text empty';
  }

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

function handleWizardConfirmSaved() {
  if (!state.keypair) return;
  state.wizard.secretConfirmed = true;
  updateWizardUI();
  focusStep(3);
}

async function handleWizardSendLobby() {
  if (!state.keypair) return;

  const room = 'lobby';
  const text = (el.wizardLobbyMsg.value || '').trim() || 'gm from technocore console';

  const guard = detectSensitiveContent(text);
  if (guard.sensitive) {
    el.wizardLobbyResult.className = 'result-callout error';
    el.wizardLobbyResult.innerHTML = `
      <div class="result-title">Security Guard Notice</div>
      <div class="result-body">${escapeHtml(guard.description || 'Sensitive content detected.')}</div>
    `;
    el.wizardLobbyResult.style.display = 'flex';
    return;
  }

  el.wizardBtnSendLobby.disabled = true;
  el.wizardBtnSendLobby.textContent = 'Sending...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, room, text);

    if (res.ok) {
      state.wizard.lobbySent = true;
      state.wizard.lobbyTimestamp = new Date().toISOString();
      state.wizard.lobbySeq = res.seq !== undefined ? res.seq : null;

      const laneStr = (res.lane || res.transport || 'POST').toUpperCase();
      el.wizardLobbyResult.className = 'result-callout success';
      el.wizardLobbyResult.innerHTML = `
        <div class="result-title">Lobby Introduction Dispatched</div>
        <div class="result-body">Message dispatched to /r/lobby via ${laneStr}. Proceed to step 4.</div>
      `;
      el.wizardLobbyResult.style.display = 'flex';

      if (visualizer) visualizer.onMessageDispatched();
      updateWizardUI();
      focusStep(4);
    } else {
      el.wizardLobbyResult.className = 'result-callout error';
      el.wizardLobbyResult.innerHTML = `
        <div class="result-title">Lobby Send Failed</div>
        <div class="result-body">Server returned status HTTP ${res.status}: ${escapeHtml(res.text)}</div>
      `;
      el.wizardLobbyResult.style.display = 'flex';
    }
  } catch (err) {
    el.wizardLobbyResult.className = 'result-callout error';
    el.wizardLobbyResult.innerHTML = `
      <div class="result-title">Network Error</div>
      <div class="result-body">${escapeHtml(err.message)}</div>
    `;
    el.wizardLobbyResult.style.display = 'flex';
  } finally {
    el.wizardBtnSendLobby.disabled = false;
    el.wizardBtnSendLobby.textContent = 'Send Lobby Introduction';
  }
}

function checkWizardContribForm() {
  const isPublic = el.chkContribPublic.checked;
  const isMention = el.chkContribMention.checked;
  const urlVal = (el.wizardContribUrl.value || '').trim();
  const isValidUrl = urlVal.startsWith('http://') || urlVal.startsWith('https://');

  el.wizardBtnConfirmContrib.disabled = !(isPublic && isMention && isValidUrl);
}

function handleWizardConfirmContrib() {
  const urlVal = (el.wizardContribUrl.value || '').trim();
  if (!urlVal) return;

  state.wizard.contributionUrl = urlVal;
  state.wizard.contributionConfirmed = true;
  updateWizardUI();
  focusStep(5);
}

async function handleWizardSendTechnocore() {
  if (!state.keypair || !state.wizard.contributionUrl) return;

  const room = 'technocore';
  const text = `Contribution: ${state.wizard.contributionUrl}`;

  el.wizardBtnSendTechnocore.disabled = true;
  el.wizardBtnSendTechnocore.textContent = 'Recording in Room...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, room, text);

    if (res.ok) {
      state.wizard.technocoreSent = true;
      state.wizard.technocoreTimestamp = new Date().toISOString();
      state.wizard.technocoreSeq = res.seq !== undefined ? res.seq : null;

      el.wizardTechnocoreResult.className = 'result-callout success';
      el.wizardTechnocoreResult.innerHTML = `
        <div class="result-title">Recorded in Technocore Room</div>
        <div class="result-body">Your signed record is published to /r/technocore. Step 6 proof is unlocked.</div>
      `;
      el.wizardTechnocoreResult.style.display = 'flex';

      if (visualizer) visualizer.onMessageDispatched();
      updateWizardUI();
      focusStep(6);
    } else {
      el.wizardTechnocoreResult.className = 'result-callout error';
      el.wizardTechnocoreResult.innerHTML = `
        <div class="result-title">Record Failed</div>
        <div class="result-body">Server returned status HTTP ${res.status}: ${escapeHtml(res.text)}</div>
      `;
      el.wizardTechnocoreResult.style.display = 'flex';
    }
  } catch (err) {
    el.wizardTechnocoreResult.className = 'result-callout error';
    el.wizardTechnocoreResult.innerHTML = `
      <div class="result-title">Network Error</div>
      <div class="result-body">${escapeHtml(err.message)}</div>
    `;
    el.wizardTechnocoreResult.style.display = 'flex';
  } finally {
    el.wizardBtnSendTechnocore.disabled = false;
    el.wizardBtnSendTechnocore.textContent = 'Record in Technocore Room';
  }
}

function updateShareText() {
  if (!state.keypair) return;
  const text = `Completed the Technocore Genesis onboarding flow with DID: ${state.keypair.did} @technocore_chat`;
  el.wizardShareText.value = text;
}

function handleOpenXComposer() {
  const shareText = el.wizardShareText.value || '';
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  window.open(xUrl, '_blank', 'noopener,noreferrer');
}

function handleDownloadProof(format) {
  if (!state.keypair) return;

  const proof = {
    client: 'Technocore Console V4 by Asad Lee',
    disclaimer: 'No persistent backend or database. Private keys remain client-side. Not an official FLOP Labs product.',
    did: state.keypair.did,
    timestamp: new Date().toISOString(),
    lobby: {
      sent: state.wizard.lobbySent,
      timestamp: state.wizard.lobbyTimestamp
    },
    contribution: {
      url: state.wizard.contributionUrl,
      technocoreSent: state.wizard.technocoreSent,
      timestamp: state.wizard.technocoreTimestamp
    }
  };

  let content = '';
  let filename = `technocore-proof-${Date.now()}`;
  let mimeType = '';

  if (format === 'json') {
    content = JSON.stringify(proof, null, 2);
    filename += '.json';
    mimeType = 'application/json';
  } else {
    content = `TECHNOCORE PROTOCOL GENESIS PROOF\n===============================\nDID: ${proof.did}\nContribution: ${proof.contribution.url}\nTimestamp: ${proof.timestamp}\nClient: Technocore Console V4\n`;
    filename += '.txt';
    mimeType = 'text/plain';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function focusStep(stepNum) {
  const targetCard = document.getElementById(`step-card-${stepNum}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ==========================================================================
   OFFLINE SIGNATURE VERIFIER
   ========================================================================== */

function handleQuickParse() {
  const raw = (el.verifyQuickInput.value || '').trim();
  if (!raw) return;

  if (raw.includes('/say-signed/')) {
    try {
      const match = raw.match(/\/r\/([^/]+)\/say-signed\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
      if (match) {
        el.verifyRoomInput.value = match[1];
        el.verifyDidInput.value = match[2];
        el.verifySigInput.value = match[3];
        el.verifyNonceInput.value = match[4];
        el.verifyMsgInput.value = decodeURIComponent(match[5]);
        el.verifyResultBox.style.display = 'none';
      }
    } catch (e) {
      console.warn('URL parsing failure:', e);
    }
  } else if (raw.startsWith('did:key:z')) {
    el.verifyDidInput.value = raw;
    el.verifyResultBox.style.display = 'none';
  }
}

function handleRunVerify() {
  if (typeof nacl === 'undefined') {
    renderVerifyResult(false, 'TweetNaCl crypto library is not loaded.');
    return;
  }

  const did = (el.verifyDidInput.value || '').trim();
  const sig = (el.verifySigInput.value || '').trim();
  const room = (el.verifyRoomInput.value || 'lobby').trim();
  const nonce = (el.verifyNonceInput.value || '').trim();
  const msg = el.verifyMsgInput.value || '';

  const res = verifyMessageSignature(nacl, did, sig, room, nonce, msg);
  if (res.valid) {
    renderVerifyResult(true, 'The signature is valid for this did:key, room, nonce, and message text.');
  } else {
    renderVerifyResult(false, res.error || 'The signature does not match this content or the did:key is malformed.');
  }
}

function renderVerifyResult(isValid, message) {
  el.verifyResultBox.className = `result-callout ${isValid ? 'success' : 'error'}`;
  el.verifyResultBox.innerHTML = `
    <div class="result-title">${isValid ? 'Signature Valid' : 'Signature Invalid'}</div>
    <div class="result-body">${escapeHtml(message)}</div>
  `;
  el.verifyResultBox.style.display = 'flex';
}

function handleClearVerify() {
  el.verifyQuickInput.value = '';
  el.verifyDidInput.value = '';
  el.verifyRoomInput.value = 'lobby';
  el.verifySigInput.value = '';
  el.verifyNonceInput.value = '';
  el.verifyMsgInput.value = '';
  el.verifyResultBox.style.display = 'none';
}

/* ==========================================================================
   MEMORY VAULT
   ========================================================================== */

async function computeMemoryPath(did, memoryId) {
  const didFp = await sha256Hex(did);
  const shard = didFp.slice(0, 2);
  const key = didFp.slice(2, 16);
  const memFp = await sha256Hex(memoryId);
  const memKey = memFp.slice(0, 16);
  return { ns: `memory-${shard}${key}`, key: memKey, full: `/kv/memory-${shard}${key}/${memKey}` };
}

async function updateVaultNotePath() {
  if (!state.keypair || !el.vaultNotePathPreview) return;
  try {
    const didFp = await sha256Hex(state.keypair.did);
    const shard = didFp.slice(0, 2);
    const remainder = didFp.slice(2, 16);
    el.vaultNotePathPreview.textContent = `/kv/memory-${shard}${remainder}/<memory-fingerprint>`;
    el.vaultNotePathPreview.className = 'readout-text';
  } catch {
    el.vaultNotePathPreview.textContent = 'Unable to compute path.';
  }
}

function updateVaultSummary() {
  const memories = state.vault.memories;
  el.vaultStatTotal.textContent = String(memories.length);
  el.vaultStatVerified.textContent = String(memories.filter(m => m._verifyState === 'valid').length);
  if (memories.length > 0) {
    const last = memories[memories.length - 1];
    const d = new Date(last.created);
    el.vaultStatLast.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    el.vaultStatLast.textContent = 'None';
  }
  el.btnVaultExport.disabled = memories.length === 0;
}

function renderVaultTimeline() {
  const memories = state.vault.memories;
  if (memories.length === 0) {
    el.vaultTimelineList.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No memories saved yet.</div>
        <div class="empty-desc">Save a memory using the form on the left. Each memory is signed with your active did:key before being stored.</div>
      </div>`;
    return;
  }

  const groups = {};
  for (const mem of memories) {
    const day = new Date(mem.created).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    if (!groups[day]) groups[day] = [];
    groups[day].push(mem);
  }

  let html = '';
  for (const [day, mems] of Object.entries(groups)) {
    html += `<div class="vault-day-divider">${escapeHtml(day)}</div>`;
    for (const mem of mems) {
      const ts = new Date(mem.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const preview = mem.text.length > 200 ? mem.text.slice(0, 200) + '...' : mem.text;
      const badgeClass = mem._verifyState === 'valid' ? 'valid' : mem._verifyState === 'invalid' ? 'invalid' : 'pending';
      const badgeText = mem._verifyState === 'valid' ? 'Verified' : mem._verifyState === 'invalid' ? 'Invalid' : 'Unverified';
      html += `
        <div class="vault-memory-card" data-id="${escapeHtml(mem.id)}">
          <div class="vault-memory-meta">
            <span class="vault-category-pill">${escapeHtml(mem.category)}</span>
            <span class="vault-memory-timestamp">${escapeHtml(ts)}</span>
          </div>
          <div class="vault-memory-body">${escapeHtml(preview)}</div>
          <div class="vault-memory-note-path">${escapeHtml(mem._notePath || '')}</div>
          <div class="vault-memory-actions">
            <span class="vault-verify-badge ${badgeClass}">${badgeText}</span>
            <button class="btn btn-secondary" type="button" onclick="window._vaultVerify('${escapeHtml(mem.id)}')" style="padding: 2px 8px; font-size: 0.7rem;">Verify Locally</button>
          </div>
        </div>`;
    }
  }

  el.vaultTimelineList.innerHTML = html;
}

window._vaultVerify = function(memId) {
  if (typeof nacl === 'undefined') return;
  const mem = state.vault.memories.find(m => m.id === memId);
  if (!mem) return;
  const result = verifyMemorySignature(nacl, mem.did, mem.signature, mem.id, mem.created, mem.text);
  mem._verifyState = result.valid ? 'valid' : 'invalid';
  state.vault.verifiedCount = state.vault.memories.filter(m => m._verifyState === 'valid').length;
  renderVaultTimeline();
  updateVaultSummary();
};

async function handleVaultSave() {
  if (!state.keypair) {
    showVaultSaveResult('error', 'No identity loaded. Generate or restore a did:key identity first.');
    return;
  }

  const text = (el.vaultMemoryText.value || '').trim();
  if (!text) {
    showVaultSaveResult('error', 'Memory text is empty. Enter memory content before saving.');
    return;
  }
  if (text.length > 500) {
    showVaultSaveResult('error', `Memory text is ${text.length} characters. Maximum is 500 characters.`);
    return;
  }

  const guard = detectSensitiveContent(text);
  if (guard.sensitive) {
    showVaultSaveResult('error', `Memory blocked: ${guard.description}`);
    return;
  }

  const category = el.vaultCategorySelect.value || 'knowledge';
  const memoryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = new Date().toISOString();
  const did = state.keypair.did;

  const signature = signMemory(nacl, state.keypair.secretKey, memoryId, created, text);
  const { ns, key: noteKey, full: notePath } = await computeMemoryPath(did, memoryId);

  const memObj = { id: memoryId, category, text, created, did, signature };
  const noteValue = JSON.stringify(memObj);

  if (noteValue.length > 8000) {
    showVaultSaveResult('error', 'Memory content is too large after encoding.');
    return;
  }

  showVaultSaveResult('info', 'Signing and storing memory...');
  el.btnVaultSave.disabled = true;

  try {
    const encodedValue = encodeURIComponent(noteValue);
    const result = await fetchProtocol(`kv/${ns}/${noteKey}/set/${encodedValue}`);

    memObj._notePath = notePath;
    memObj._verifyState = 'valid';
    state.vault.memories.push(memObj);
    state.vault.verifiedCount = state.vault.memories.filter(m => m._verifyState === 'valid').length;

    if (result.ok) {
      showVaultSaveResult('success', `Memory saved. Note path: ${notePath}`);
    } else {
      showVaultSaveResult('error', `Memory stored locally, but network write failed (status ${result.status}). Note path: ${notePath}`);
    }

    el.vaultMemoryText.value = '';
    renderVaultTimeline();
    updateVaultSummary();
  } catch (err) {
    memObj._notePath = notePath;
    memObj._verifyState = 'valid';
    state.vault.memories.push(memObj);
    renderVaultTimeline();
    updateVaultSummary();
    showVaultSaveResult('error', `Memory stored locally in this session: ${err.message}. Note path: ${notePath}`);
  } finally {
    el.btnVaultSave.disabled = !state.keypair;
  }
}

function handleVaultExport() {
  const memories = state.vault.memories;
  if (memories.length === 0) return;

  const exportObj = {
    exported: new Date().toISOString(),
    tool: 'Technocore Console V4 by Asad Lee',
    source: 'https://github.com/Asadlee24/technocore-console',
    disclaimer: 'Personal record of activity. Not an official FLOP Labs product. Technocore is not a permanent archive.',
    memories: memories.map(m => ({ id: m.id, category: m.category, text: m.text, created: m.created, did: m.did, signature: m.signature, notePath: m._notePath }))
  };

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `technocore-memories-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function handleVaultRestoreByDid() {
  const rawDid = (el.vaultRestoreDidInput.value || '').trim() || (state.keypair ? state.keypair.did : '');
  if (!rawDid || !rawDid.startsWith('did:key:z')) {
    showVaultRestoreResult('error', 'Enter a valid did:key identifier or load an active identity first.');
    return;
  }

  showVaultRestoreResult('info', 'Looking up memory notes for this identity...');
  el.btnVaultRestoreDid.disabled = true;

  try {
    const didFp = await sha256Hex(rawDid);
    const shard = didFp.slice(0, 2);
    const remainder = didFp.slice(2, 16);
    const ns = `memory-${shard}${remainder}`;

    const listResult = await fetchProtocol(`kv/${ns}`);
    if (!listResult.ok) {
      showVaultRestoreResult('error', `No memory notes found under /kv/${ns}.`);
      el.btnVaultRestoreDid.disabled = false;
      return;
    }

    const lines = listResult.text.trim().split('\n').filter(Boolean);
    const restored = [];

    for (const keyLine of lines) {
      const parts = keyLine.trim().split('/').filter(Boolean);
      const noteKey = parts[parts.length - 1];
      if (!noteKey) continue;

      try {
        const noteResult = await fetchProtocol(`kv/${ns}/${noteKey}`);
        if (!noteResult.ok || !noteResult.text.trim()) continue;
        const firstBrace = noteResult.text.indexOf('{');
        if (firstBrace === -1) continue;

        const memObj = JSON.parse(noteResult.text.slice(firstBrace).trim());
        if (!memObj.id || !memObj.signature || !memObj.did) continue;

        const vResult = verifyMemorySignature(nacl, memObj.did, memObj.signature, memObj.id, memObj.created, memObj.text);
        memObj._verifyState = vResult.valid ? 'valid' : 'invalid';
        memObj._notePath = `/kv/${ns}/${noteKey}`;
        restored.push(memObj);
      } catch { /* skip corrupted notes */ }
    }

    const existingIds = new Set(state.vault.memories.map(m => m.id));
    let added = 0;
    for (const mem of restored) {
      if (!existingIds.has(mem.id)) {
        state.vault.memories.push(mem);
        added++;
      }
    }
    state.vault.memories.sort((a, b) => new Date(a.created) - new Date(b.created));
    state.vault.verifiedCount = state.vault.memories.filter(m => m._verifyState === 'valid').length;

    renderVaultTimeline();
    updateVaultSummary();
    showVaultRestoreResult('success', `Restored ${restored.length} memory note(s) (${added} new to this session).`);
  } catch (err) {
    showVaultRestoreResult('error', `Restore failed: ${err.message}`);
  } finally {
    el.btnVaultRestoreDid.disabled = false;
  }
}

function handleVaultImportFile() {
  const file = el.vaultImportFile.files && el.vaultImportFile.files[0];
  if (!file) {
    showVaultRestoreResult('error', 'Choose a previously exported Technocore memories JSON file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.memories || !Array.isArray(data.memories)) {
        showVaultRestoreResult('error', 'Invalid Technocore memories file.');
        return;
      }

      let added = 0;
      const existingIds = new Set(state.vault.memories.map(m => m.id));

      for (const mem of data.memories) {
        if (!mem.id || !mem.text || !mem.did || !mem.signature || !mem.created) continue;
        if (existingIds.has(mem.id)) continue;

        const vResult = verifyMemorySignature(nacl, mem.did, mem.signature, mem.id, mem.created, mem.text);
        mem._verifyState = vResult.valid ? 'valid' : 'invalid';
        mem._notePath = mem.notePath || '';
        state.vault.memories.push(mem);
        existingIds.add(mem.id);
        added++;
      }

      state.vault.memories.sort((a, b) => new Date(a.created) - new Date(b.created));
      state.vault.verifiedCount = state.vault.memories.filter(m => m._verifyState === 'valid').length;

      renderVaultTimeline();
      updateVaultSummary();
      showVaultRestoreResult('success', `Loaded ${added} memory record(s) from file.`);
    } catch (err) {
      showVaultRestoreResult('error', `Failed to read file: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function showVaultSaveResult(type, message) {
  el.vaultSaveResult.className = `result-callout ${type}`;
  el.vaultSaveResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.vaultSaveResult.style.display = 'flex';
}

function showVaultRestoreResult(type, message) {
  el.vaultRestoreResult.className = `result-callout ${type}`;
  el.vaultRestoreResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.vaultRestoreResult.style.display = 'flex';
}

/* ==========================================================================
   SONNET CHALLENGE MODE (Authoritative State Machine)
   ========================================================================== */

/**
 * Initialize Sonnet Challenge
 */
async function initSonnet() {
  if (!el.sonnetView) return;

  renderSonnetPoemLines();
  updateSonnetStateUI();
  updateSonnetPreviews();
  renderSonnetReceipts();

  // Load frozen CMUdict lexicon
  try {
    const loaded = await loadFrozenLexicon('./cmudict.dict');
    state.sonnet.lexiconLoaded = loaded;
    if (el.sonnetInfoDictHash) {
      el.sonnetInfoDictHash.textContent = 'SHA-256 Verified (81917843...)';
      el.sonnetInfoDictHash.classList.add('badge-accepted');
    }
  } catch (err) {
    console.warn('CMUdict load notice:', err.message);
  }

  // Ensure receiptEngine has TweetNaCl instance for local Ed25519 verification
  if (typeof nacl !== 'undefined') {
    receiptEngine.setNacl(nacl);
  }

  // Poll rules, registration and discovery rooms for referee updates
  pollSonnetRoom(SONNET_CONFIG.rooms.rules);
  pollSonnetRoom(SONNET_CONFIG.rooms.registration);
  pollSonnetRoom(SONNET_CONFIG.rooms.discovery);
}

/**
 * Poll a contest room for referee receipts
 */
function pollSonnetRoom(roomName) {
  if (!roomName || activeSonnetPollers.has(roomName)) return;

  const poller = new RoomPoller(roomName, {
    onMessages: (messages) => {
      // If messages from rules room arrive, attempt to extract and pin official referee DID
      if (roomName === SONNET_CONFIG.rooms.rules) {
        const pinned = extractAndPinRefereeFromRules(messages, nacl);
        if (pinned) {
          receiptEngine.setPinnedReferee(pinned);
          updateSonnetStateUI();
        }
      }
      for (const msg of messages) {
        processIncomingSonnetMessage(msg);
      }
    }
  });
  activeSonnetPollers.set(roomName, poller);
  poller.start();
}

/**
 * Ingest and process an incoming message for referee receipts
 */
function processIncomingSonnetMessage(msg) {
  const receipt = receiptEngine.ingestMessage(msg, getPinnedReferee());
  if (receipt && !receipt.rejected) {
    applyRefereeReceiptToSonnetState(receipt);
    renderSonnetReceipts();
    updateSonnetStateUI();
    updateSonnetPreviews();
  } else if (receipt && receipt.rejected) {
    renderSonnetReceipts();
  }
}

/**
 * Apply authoritative referee receipt to volatile Sonnet state
 * STRICT INVARIANT: Receipts must be strictly scoped to this user/session.
 * Never allow another participant's public receipt to mutate local state.
 */
function applyRefereeReceiptToSonnetState(receipt) {
  if (!receipt || receipt.isStale || receipt.rejected) return;

  const myDid = state.keypair ? state.keypair.did : null;

  // 1. Role Registration Acceptance (Scoped to our active request ID or active DID)
  const isMyRegistration = Boolean(
    (state.sonnet.lastRegistrationReqId && receipt.requestId === state.sonnet.lastRegistrationReqId) ||
    (myDid && receipt.authenticatedDid && receipt.authenticatedDid.toLowerCase() === myDid.toLowerCase())
  );

  if (isMyRegistration && receipt.role && receipt.actionStatus === 'ACCEPTED') {
    state.sonnet.registrationAccepted = true;
    state.sonnet.role = receipt.role;
    state.sonnet.roleLocked = true;
    state.sonnet.registrationPending = false;

    el.sonnetRegLockBadge.textContent = `Locked (${receipt.role.toUpperCase()})`;
    el.sonnetRegLockBadge.className = 'step-status-pill completed';
    el.sonnetEligibilityBadge.textContent = `Verified Eligible (${receipt.role.toUpperCase()})`;
    el.sonnetEligibilityBadge.className = 'step-status-pill completed';
    el.sonnetStatRole.textContent = receipt.role.toUpperCase();
    el.sonnetProofRole.textContent = receipt.role.toUpperCase();
    el.sonnetProofEvidence.textContent = `Authoritative referee receipt verified (Seq: ${receipt.sequence !== null ? receipt.sequence : 'confirmed'})`;
    el.sonnetProofSeq.textContent = receipt.sequence !== null ? String(receipt.sequence) : 'Confirmed';
    el.sonnetProofSigState.textContent = receipt.receiptSignatureStatus || 'SERVER AUTHENTICATED';
  }

  // 2. Team Room & Generation Allocation (Strictly scoped to our outgoing team request)
  const isMyTeamReq = Boolean(
    state.sonnet.lastTeamReqId &&
    receipt.requestId === state.sonnet.lastTeamReqId
  );

  if (isMyTeamReq && receipt.actionStatus === 'ACCEPTED' && receipt.gameId) {
    state.sonnet.gameId = receipt.gameId;
    el.sonnetStatGame.textContent = receipt.gameId;

    if (receipt.poemRoom) {
      state.sonnet.allocatedPoemRoom = receipt.poemRoom;
      state.sonnet.teamRequestAccepted = true;
      state.sonnet.teamRequestPending = false;
      el.sonnetAllocatedRoomDisplay.textContent = receipt.poemRoom;
      el.sonnetAllocatedRoomDisplay.className = 'readout-text';
      // Actively poll the allocated poem room
      pollSonnetRoom(receipt.poemRoom);
    }

    if (receipt.roomGeneration !== null) {
      state.sonnet.roomGeneration = receipt.roomGeneration;
      el.sonnetReadoutGen.textContent = String(receipt.roomGeneration);
    }

    if (receipt.version !== null) {
      state.sonnet.currentVersion = receipt.version;
      el.sonnetReadoutVer.textContent = String(receipt.version);
      el.sonnetStatVersion.textContent = String(receipt.version);
    }

    if (receipt.stateHash) {
      state.sonnet.previousStateHash = receipt.stateHash;
      el.sonnetReadoutPrevHash.textContent = receipt.stateHash;
    }
  }

  // 3. Roster acceptance (Strictly scoped to our roster request and current gameId)
  const isMyRosterReq = Boolean(
    state.sonnet.lastRosterReqId &&
    receipt.requestId === state.sonnet.lastRosterReqId &&
    (!state.sonnet.gameId || receipt.gameId === state.sonnet.gameId)
  );

  if (isMyRosterReq && receipt.actionStatus === 'ACCEPTED') {
    state.sonnet.rosterAccepted = true;
    el.sonnetRosterFreezeBadge.textContent = 'Roster Signed & Verified';
    el.sonnetRosterFreezeBadge.className = 'step-status-pill completed';
  }

  // 4. Accepted Word (Scoped to our assigned gameId and valid state transition)
  const matchesCurrentGame = Boolean(
    state.sonnet.gameId &&
    receipt.gameId === state.sonnet.gameId
  );

  if (matchesCurrentGame && receipt.actionStatus === 'ACCEPTED' && receipt.word) {
    const wordKey = receipt.version !== null ? `ver-${receipt.version}` : `seq-${receipt.sequence || receipt.requestId}`;
    if (!state.sonnet.acceptedWordVersions.has(wordKey)) {
      state.sonnet.acceptedWordVersions.set(wordKey, {
        word: receipt.word,
        version: receipt.version,
        sequence: receipt.sequence,
        contributor: receipt.authenticatedDid
      });

      // Reconstruct word array sorted by version/sequence (preserves legitimate duplicate words)
      const sortedEntries = Array.from(state.sonnet.acceptedWordVersions.values()).sort((a, b) => {
        if (a.version !== null && b.version !== null) return a.version - b.version;
        if (a.sequence !== null && b.sequence !== null) return a.sequence - b.sequence;
        return 0;
      });
      state.sonnet.words = sortedEntries.map(e => e.word);
      renderSonnetPoemLines();
    }

    if (receipt.version !== null) {
      state.sonnet.currentVersion = receipt.version;
      el.sonnetReadoutVer.textContent = String(receipt.version);
      el.sonnetStatVersion.textContent = String(receipt.version);
    }
    if (receipt.stateHash) {
      state.sonnet.previousStateHash = receipt.stateHash;
      el.sonnetReadoutPrevHash.textContent = receipt.stateHash;
    }
    if (receipt.roomGeneration !== null) {
      state.sonnet.roomGeneration = receipt.roomGeneration;
      el.sonnetReadoutGen.textContent = String(receipt.roomGeneration);
    }

    state.sonnet.rosterFrozen = true;
    el.sonnetRosterFreezeBadge.textContent = 'Frozen (First Word Accepted)';
    el.sonnetRosterFreezeBadge.className = 'step-status-pill completed';
    if (receipt.authenticatedDid) {
      state.sonnet.lastContributor = receipt.authenticatedDid;
      el.sonnetReadoutLastAuthor.textContent = receipt.authenticatedDid.slice(0, 16) + '...';
    }
  }

  // 5. Submission acceptance (Strictly scoped to our submission request)
  const isMySubmitReq = Boolean(
    state.sonnet.lastSubmitReqId &&
    receipt.requestId === state.sonnet.lastSubmitReqId &&
    matchesCurrentGame
  );

  if (isMySubmitReq && receipt.actionStatus === 'ACCEPTED') {
    state.sonnet.submissionAccepted = true;
    state.sonnet.submissionPending = false;
    // INVARIANT: Never fabricate entry ID. Null until referee supplies it.
    state.sonnet.submittedEntryId = receipt.entryId || null;
  }

  // 6. Ballot acceptance (Strictly scoped to our ballot request)
  const isMyBallotReq = Boolean(
    state.sonnet.lastBallotReqId &&
    receipt.requestId === state.sonnet.lastBallotReqId
  );

  if (isMyBallotReq && receipt.actionStatus === 'ACCEPTED') {
    state.sonnet.ballotAccepted = true;
    state.sonnet.ballotPending = false;
  }

  // 7. Claim acceptance (Strictly scoped to our claim request)
  const isMyClaimReq = Boolean(
    state.sonnet.lastClaimReqId &&
    receipt.requestId === state.sonnet.lastClaimReqId &&
    matchesCurrentGame
  );

  if (isMyClaimReq && receipt.actionStatus === 'ACCEPTED') {
    state.sonnet.claimAccepted = true;
    state.sonnet.claimPending = false;
  }
}

/**
 * Bind Sonnet-specific DOM event listeners
 */
function bindSonnetEvents() {
  if (!el.sonnetView) return;

  if (el.sonnetBtnCopyDid) {
    el.sonnetBtnCopyDid.addEventListener('click', () => {
      copyToClipboard(state.keypair ? state.keypair.did : '', 'DID copied to clipboard.');
    });
  }

  if (el.sonnetRegRoleSelect) {
    el.sonnetRegRoleSelect.addEventListener('change', (e) => {
      state.sonnet.role = e.target.value;
      if (el.sonnetRegXGroup) {
        el.sonnetRegXGroup.style.display = state.sonnet.role === 'writer' ? 'flex' : 'none';
      }
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }

  if (el.sonnetRegXUrl) {
    el.sonnetRegXUrl.addEventListener('input', (e) => {
      state.sonnet.xAccountUrl = e.target.value.trim();
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }

  if (el.sonnetRegRequestId) {
    el.sonnetRegRequestId.addEventListener('input', updateSonnetPreviews);
  }

  if (el.sonnetBtnSendRegister) {
    el.sonnetBtnSendRegister.addEventListener('click', handleSonnetSendRegister);
  }

  if (el.sonnetTeamGameId) {
    el.sonnetTeamGameId.addEventListener('input', (e) => {
      state.sonnet.gameId = cleanRoomName(e.target.value).slice(0, 16);
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }

  if (el.sonnetTeamReqId) {
    el.sonnetTeamReqId.addEventListener('input', updateSonnetPreviews);
  }

  if (el.sonnetBtnSendTeamReq) {
    el.sonnetBtnSendTeamReq.addEventListener('click', handleSonnetSendTeamRequest);
  }

  if (el.sonnetRosterMembersInput) {
    el.sonnetRosterMembersInput.addEventListener('input', () => {
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }

  if (el.sonnetBtnSignRoster) {
    el.sonnetBtnSignRoster.addEventListener('click', handleSonnetSignRoster);
  }

  if (el.sonnetBtnWithdrawTeam) {
    el.sonnetBtnWithdrawTeam.addEventListener('click', handleSonnetWithdrawTeam);
  }

  if (el.sonnetBtnCheckWord) {
    el.sonnetBtnCheckWord.addEventListener('click', handleSonnetCheckWord);
  }

  if (el.sonnetWordInput) {
    el.sonnetWordInput.addEventListener('input', () => {
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
    el.sonnetWordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSonnetCheckWord();
      }
    });
  }

  if (el.sonnetBtnSendWord) {
    el.sonnetBtnSendWord.addEventListener('click', handleSonnetSendWordProposal);
  }

  if (el.sonnetXPostIds) {
    el.sonnetXPostIds.addEventListener('input', () => {
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }

  if (el.sonnetBtnCopyPoem) {
    el.sonnetBtnCopyPoem.addEventListener('click', () => {
      const canonical = formatCanonicalPoem(state.sonnet.words);
      copyToClipboard(canonical, 'Exact canonical poem copied to clipboard.');
    });
  }

  if (el.sonnetBtnCopyAttribution) {
    el.sonnetBtnCopyAttribution.addEventListener('click', () => {
      const attr = `Sonnet Challenge Entry (Game: ${state.sonnet.gameId || 'unassigned'})\nComposed with Technocore Console V4 @technocore_chat`;
      copyToClipboard(attr, 'X attribution text copied to clipboard.');
    });
  }

  if (el.sonnetBtnSendSubmission) {
    el.sonnetBtnSendSubmission.addEventListener('click', handleSonnetSendSubmission);
  }

  if (el.sonnetBallotEntryId) {
    el.sonnetBallotEntryId.addEventListener('input', () => {
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }
  if (el.sonnetBallotReqId) {
    el.sonnetBallotReqId.addEventListener('input', updateSonnetPreviews);
  }
  if (el.sonnetBtnSendBallot) {
    el.sonnetBtnSendBallot.addEventListener('click', handleSonnetSendBallot);
  }

  if (el.sonnetClaimDestination) {
    el.sonnetClaimDestination.addEventListener('input', () => {
      updateSonnetPreviews();
      updateSonnetStateUI();
    });
  }
  if (el.sonnetBtnSendClaim) {
    el.sonnetBtnSendClaim.addEventListener('click', handleSonnetSendClaim);
  }

  if (el.sonnetBtnClearReceipts) {
    el.sonnetBtnClearReceipts.addEventListener('click', () => {
      receiptEngine.clear();
      renderSonnetReceipts();
    });
  }
}

/**
 * Strict Authoritative Gating of all Sonnet UI buttons and state
 */
function updateSonnetStateUI() {
  if (!el.sonnetView) return;

  const hasKey = Boolean(state.keypair);
  const isRegistered = state.sonnet.registrationAccepted && state.sonnet.roleLocked;
  const isWriter = isRegistered && state.sonnet.role === 'writer';
  const isVoter = isRegistered && state.sonnet.role === 'voter';

  // Team room gating: strictly requires referee-allocated room and room_generation
  const hasAuthoritativeTeamRoom = Boolean(
    state.sonnet.allocatedPoemRoom &&
    state.sonnet.roomGeneration !== null &&
    state.sonnet.roomGeneration >= 1
  );

  // Roster gating
  const rawMembers = el.sonnetRosterMembersInput
    ? el.sonnetRosterMembersInput.value.split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  const validMemberCount = rawMembers.length >= 4 && rawMembers.length <= 8;
  const isRosterReady = state.sonnet.rosterAccepted && hasAuthoritativeTeamRoom;

  // Word proposal gating: strictly requires authoritative version, hash, generation
  const hasAuthoritativeWordState = Boolean(
    isRosterReady &&
    hasAuthoritativeTeamRoom &&
    state.sonnet.currentVersion !== null &&
    state.sonnet.previousStateHash &&
    state.sonnet.previousStateHash.length === 64 &&
    state.sonnet.previousStateHash !== '0000000000000000000000000000000000000000000000000000000000000000'
  );

  const isNotConsecutiveTurn = Boolean(
    !state.sonnet.lastContributor ||
    !state.keypair ||
    state.sonnet.lastContributor.toLowerCase() !== state.keypair.did.toLowerCase()
  );

  const wordVal = el.sonnetWordInput ? el.sonnetWordInput.value.trim() : '';
  const wordCheck = wordVal && state.keypair ? validateCandidateWord(state.keypair.did, wordVal) : { valid: false };
  const poemValidation = validatePoemSyllables(state.sonnet.words);
  const isPoemFrozen = poemValidation.valid;

  // Identity card displays
  if (hasKey) {
    el.sonnetActiveDidReadout.textContent = state.keypair.did;
    el.sonnetActiveDidReadout.className = 'readout-text';
    el.sonnetBtnCopyDid.disabled = false;

    if (!isRegistered && !state.sonnet.registrationPending) {
      el.sonnetEligibilityBadge.textContent = 'DID Loaded (Unregistered)';
      el.sonnetEligibilityBadge.className = 'step-status-pill pending';
    }
  } else {
    el.sonnetActiveDidReadout.textContent = 'No identity loaded. Generate or restore a key first.';
    el.sonnetActiveDidReadout.className = 'readout-text empty';
    el.sonnetBtnCopyDid.disabled = true;
    el.sonnetEligibilityBadge.textContent = 'No Identity';
    el.sonnetEligibilityBadge.className = 'step-status-pill locked';
  }

  // Referee Pin Status Display
  const pinnedReferee = getPinnedReferee();
  if (el.sonnetInfoRefereeDid) {
    if (pinnedReferee) {
      el.sonnetInfoRefereeDid.textContent = `${pinnedReferee.slice(0, 16)}...${pinnedReferee.slice(-6)}`;
      el.sonnetInfoRefereeDid.title = pinnedReferee;
      el.sonnetInfoRefereeDid.className = 'badge-text badge-accepted';
    } else {
      el.sonnetInfoRefereeDid.textContent = 'Waiting for official referee pin';
      el.sonnetInfoRefereeDid.className = 'badge-text badge-pending';
    }
  }

  // Submission Entry ID Display
  if (el.sonnetSubmittedEntryId) {
    if (state.sonnet.submittedEntryId) {
      el.sonnetSubmittedEntryId.textContent = state.sonnet.submittedEntryId;
      el.sonnetSubmittedEntryId.className = 'readout-text';
    } else {
      el.sonnetSubmittedEntryId.textContent = 'Waiting for referee entry ID';
      el.sonnetSubmittedEntryId.className = 'readout-text empty';
    }
  }

  // Turn eligibility indicator
  if (el.sonnetReadoutTurnEligibility) {
    if (!hasAuthoritativeWordState) {
      el.sonnetReadoutTurnEligibility.textContent = 'Waiting for roster & referee state';
    } else if (!isNotConsecutiveTurn) {
      el.sonnetReadoutTurnEligibility.textContent = 'Ineligible (Your turn was last accepted)';
    } else {
      el.sonnetReadoutTurnEligibility.textContent = 'Eligible for turn';
    }
  }

  // 1. Registration Button
  el.sonnetBtnSendRegister.disabled = !hasKey || isRegistered || state.sonnet.registrationPending;

  // 2. Team Request Button: strictly requires accepted Writer registration
  const cleanGameId = (el.sonnetTeamGameId ? el.sonnetTeamGameId.value : '').trim();
  const validGameId = /^[a-z0-9][a-z0-9_-]{0,15}$/.test(cleanGameId);
  el.sonnetBtnSendTeamReq.disabled = !isWriter || !validGameId || state.sonnet.teamRequestPending || state.sonnet.teamRequestAccepted;

  // 3. Roster Consent Button: requires authoritative referee poem room & generation
  el.sonnetBtnSignRoster.disabled = !hasAuthoritativeTeamRoom || !validMemberCount || state.sonnet.rosterFrozen;
  if (el.sonnetBtnWithdrawTeam) {
    el.sonnetBtnWithdrawTeam.disabled = !hasAuthoritativeTeamRoom || state.sonnet.rosterFrozen;
  }

  // 4. Word Proposal Button: requires authoritative version, hash, generation, valid turn
  el.sonnetBtnSendWord.disabled = !hasAuthoritativeWordState || !isNotConsecutiveTurn || !wordCheck.valid || isPoemFrozen;

  // 5. Submission Button: strictly requires frozen poem (14 lines x 10 syllables) and authoritative version
  const xPosts = el.sonnetXPostIds ? el.sonnetXPostIds.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  el.sonnetBtnSendSubmission.disabled = !isPoemFrozen || !hasAuthoritativeTeamRoom || xPosts.length === 0 || state.sonnet.submissionAccepted;

  // 6. Ballot Button: strictly requires accepted Voter registration
  const entryId = el.sonnetBallotEntryId ? el.sonnetBallotEntryId.value.trim() : '';
  el.sonnetBtnSendBallot.disabled = !isVoter || !entryId || state.sonnet.ballotPending;

  // 7. Claim Button: strictly requires authorized winner state
  const payoutAddr = el.sonnetClaimDestination ? el.sonnetClaimDestination.value.trim() : '';
  el.sonnetBtnSendClaim.disabled = !state.sonnet.prizeAuthorized || !payoutAddr || state.sonnet.claimPending;
}

/**
 * Update dynamic JSON single-line previews without any invented fallback defaults
 */
function updateSonnetPreviews() {
  if (!el.sonnetView) return;

  const did = state.keypair ? state.keypair.did : '';
  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;

  // 1. Registration Preview
  const regRole = el.sonnetRegRoleSelect ? el.sonnetRegRoleSelect.value : 'writer';
  const regX = el.sonnetRegXUrl ? el.sonnetRegXUrl.value.trim() : '';
  const regReqId = el.sonnetRegRequestId && el.sonnetRegRequestId.value.trim() ? el.sonnetRegRequestId.value.trim() : `reg-${state.sonnet.requestIdCounter}`;
  try {
    el.sonnetRegPayloadPreview.textContent = buildSonnetRegisterPayload(contestId, regRole, regX, regReqId);
  } catch (err) {
    el.sonnetRegPayloadPreview.textContent = `[${err.message}]`;
  }

  // 2. Team Request Preview
  const gameId = el.sonnetTeamGameId && el.sonnetTeamGameId.value.trim() ? el.sonnetTeamGameId.value.trim() : '';
  const teamReqId = el.sonnetTeamReqId && el.sonnetTeamReqId.value.trim() ? el.sonnetTeamReqId.value.trim() : `room-${state.sonnet.requestIdCounter}`;
  if (!gameId) {
    el.sonnetTeamPayloadPreview.textContent = '[Enter 1–16 character Game ID to preview payload]';
  } else {
    try {
      el.sonnetTeamPayloadPreview.textContent = buildSonnetTeamRequestPayload(contestId, gameId, teamReqId);
    } catch (err) {
      el.sonnetTeamPayloadPreview.textContent = `[${err.message}]`;
    }
  }

  // 3. Roster Preview (Never invent poem_room, room_generation, or game_id)
  const rawMembers = el.sonnetRosterMembersInput ? el.sonnetRosterMembersInput.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
  if (!state.sonnet.allocatedPoemRoom || state.sonnet.roomGeneration === null || !state.sonnet.gameId) {
    el.sonnetRosterPayloadPreview.textContent = '[Waiting for referee receipt allocating game ID, poem room, and room generation]';
  } else if (rawMembers.length < 4 || rawMembers.length > 8) {
    el.sonnetRosterPayloadPreview.textContent = '[Enter 4–8 writer DIDs to preview roster payload]';
  } else {
    try {
      el.sonnetRosterPayloadPreview.textContent = buildSonnetRosterPayload(
        state.sonnet.gameId,
        state.sonnet.allocatedPoemRoom,
        state.sonnet.roomGeneration,
        rawMembers,
        `roster-${state.sonnet.requestIdCounter}`
      );
    } catch (err) {
      el.sonnetRosterPayloadPreview.textContent = `[${err.message}]`;
    }
  }

  // 4. Word Proposal Preview (Never invent version, room_generation, or previous_state_hash)
  const wordCandidate = el.sonnetWordInput ? el.sonnetWordInput.value.trim() : '';
  if (!state.sonnet.allocatedPoemRoom || state.sonnet.roomGeneration === null) {
    el.sonnetWordPayloadPreview.textContent = '[Waiting for referee: team room generation unassigned]';
  } else if (state.sonnet.currentVersion === null || !state.sonnet.previousStateHash) {
    el.sonnetWordPayloadPreview.textContent = '[Waiting for referee: authoritative version and previous_state_hash unassigned]';
  } else if (!wordCandidate) {
    el.sonnetWordPayloadPreview.textContent = '[Enter a candidate word to preview proposal payload]';
  } else {
    try {
      el.sonnetWordPayloadPreview.textContent = buildSonnetWordPayload(
        contestId,
        state.sonnet.gameId,
        state.sonnet.roomGeneration,
        state.sonnet.currentVersion,
        state.sonnet.previousStateHash,
        wordCandidate,
        `word-${state.sonnet.requestIdCounter}`
      );
    } catch (err) {
      el.sonnetWordPayloadPreview.textContent = `[${err.message}]`;
    }
  }

  // 5. Submission Preview (Never invent poem_sha256 or final_version)
  const xPosts = el.sonnetXPostIds ? el.sonnetXPostIds.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!state.sonnet.allocatedPoemRoom || state.sonnet.roomGeneration === null || !state.sonnet.gameId) {
    el.sonnetSubmitPayloadPreview.textContent = '[Waiting for referee: team room and game ID unassigned]';
  } else if (!state.sonnet.poemSha256) {
    el.sonnetSubmitPayloadPreview.textContent = '[Poem not yet frozen: 14 lines x 10 syllables required for canonical SHA-256]';
  } else if (state.sonnet.currentVersion === null) {
    el.sonnetSubmitPayloadPreview.textContent = '[Waiting for referee: final version unassigned]';
  } else if (xPosts.length === 0) {
    el.sonnetSubmitPayloadPreview.textContent = '[Enter at least 1 X post ID to preview submission payload]';
  } else {
    try {
      el.sonnetSubmitPayloadPreview.textContent = buildSonnetSubmitPayload(
        contestId,
        state.sonnet.gameId,
        state.sonnet.allocatedPoemRoom,
        state.sonnet.roomGeneration,
        state.sonnet.currentVersion,
        state.sonnet.poemSha256,
        xPosts,
        `sub-${state.sonnet.requestIdCounter}`
      );
    } catch (err) {
      el.sonnetSubmitPayloadPreview.textContent = `[${err.message}]`;
    }
  }

  // 6. Ballot Preview (Never guess voter eligibility or entry ID)
  const entryId = el.sonnetBallotEntryId ? el.sonnetBallotEntryId.value.trim() : '';
  const ballotReqId = el.sonnetBallotReqId && el.sonnetBallotReqId.value.trim() ? el.sonnetBallotReqId.value.trim() : `ballot-${state.sonnet.requestIdCounter}`;
  if (!did || state.sonnet.role !== 'voter' || !state.sonnet.registrationAccepted) {
    el.sonnetBallotPayloadPreview.textContent = '[Ballot requires accepted Voter registration]';
  } else if (!entryId) {
    el.sonnetBallotPayloadPreview.textContent = '[Enter target submitted entry ID to preview ballot payload]';
  } else {
    try {
      el.sonnetBallotPayloadPreview.textContent = buildSonnetBallotPayload(contestId, did, entryId, ballotReqId);
    } catch (err) {
      el.sonnetBallotPayloadPreview.textContent = `[${err.message}]`;
    }
  }
}

/**
 * Handle Registration Dispatch
 * Invariant: HTTP 200 NEVER locks the role. Role locks strictly upon referee receipt.
 */
async function handleSonnetSendRegister() {
  if (!state.keypair) return;

  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;
  const role = el.sonnetRegRoleSelect.value;
  const xUrl = el.sonnetRegXUrl.value.trim();
  const reqId = el.sonnetRegRequestId.value.trim() || `reg-${Date.now()}`;

  if (role === 'writer' && !xUrl) {
    showSonnetRegResult('error', 'Writers must provide a public X URL per official Sonnet rules.');
    return;
  }

  let payload;
  try {
    payload = buildSonnetRegisterPayload(contestId, role, xUrl, reqId);
  } catch (err) {
    showSonnetRegResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.registration;
  el.sonnetBtnSendRegister.disabled = true;
  el.sonnetBtnSendRegister.textContent = 'Dispatching Signed Registration...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);

    receiptEngine.recordAction({
      requestId: reqId,
      actionType: 'register',
      authenticatedDid: state.keypair.did,
      room: targetRoom,
      sequence: res.seq || null, // Never Date.now()!
      httpStatus: res.status,
      contestId: contestId,
      actionStatus: res.ok ? 'TRANSPORT SUCCESS' : 'TRANSPORT FAILED'
    });

    if (res.ok) {
      state.sonnet.registrationPending = true;
      state.sonnet.lastRegistrationReqId = reqId;

      // Invariant: Role remains UNLOCKED until referee receipt arrives
      el.sonnetRegLockBadge.textContent = 'Pending Referee';
      el.sonnetRegLockBadge.className = 'step-status-pill pending';
      el.sonnetEligibilityBadge.textContent = 'Registration Pending';
      el.sonnetEligibilityBadge.className = 'step-status-pill pending';
      const laneStr = (res.lane || res.transport || 'POST').toUpperCase();
      el.sonnetProofEvidence.textContent = `Dispatched via ${laneStr}. Polling /r/${targetRoom} for referee receipt...`;
      el.sonnetProofRole.textContent = `${role.toUpperCase()} (Pending)`;

      showSonnetRegResult('info', `Registration dispatched (HTTP ${res.status}). Transport success != referee accepted. Awaiting authoritative referee receipt.`);
      pollSonnetRoom(targetRoom);
    } else {
      showSonnetRegResult('error', `Server rejected registration request. HTTP ${res.status}: ${res.text}`);
    }
    renderSonnetReceipts();
  } catch (err) {
    showSonnetRegResult('error', `Transport error: ${err.message}`);
  } finally {
    state.sonnet.requestIdCounter++;
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Handle Team Request Dispatch
 */
async function handleSonnetSendTeamRequest() {
  if (!state.keypair) return;

  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;
  const gameId = (el.sonnetTeamGameId.value || '').trim();
  const reqId = el.sonnetTeamReqId.value.trim() || `room-${Date.now()}`;

  let payload;
  try {
    payload = buildSonnetTeamRequestPayload(contestId, gameId, reqId);
  } catch (err) {
    showSonnetTeamResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.discovery;
  el.sonnetBtnSendTeamReq.disabled = true;
  el.sonnetBtnSendTeamReq.textContent = 'Dispatching Team Request...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);

    receiptEngine.recordAction({
      requestId: reqId,
      actionType: 'team-request',
      authenticatedDid: state.keypair.did,
      room: targetRoom,
      sequence: res.seq || null,
      httpStatus: res.status,
      contestId: contestId,
      gameId: gameId,
      actionStatus: res.ok ? 'TRANSPORT SUCCESS' : 'TRANSPORT FAILED'
    });

    if (res.ok) {
      state.sonnet.teamRequestPending = true;
      state.sonnet.lastTeamReqId = reqId;
      el.sonnetAllocatedRoomDisplay.textContent = 'Dispatched. Waiting for referee allocation receipt...';
      el.sonnetAllocatedRoomDisplay.className = 'readout-text empty';

      showSonnetTeamResult('info', `Team request dispatched to /r/${targetRoom}. Awaiting referee allocation receipt for generation & room.`);
      pollSonnetRoom(targetRoom);
    } else {
      showSonnetTeamResult('error', `Server rejected request. HTTP ${res.status}: ${res.text}`);
    }
    renderSonnetReceipts();
  } catch (err) {
    showSonnetTeamResult('error', `Transport error: ${err.message}`);
  } finally {
    state.sonnet.requestIdCounter++;
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Handle Roster Consent Dispatch
 */
async function handleSonnetSignRoster() {
  if (!state.keypair) return;

  const gameId = state.sonnet.gameId;
  const poemRoom = state.sonnet.allocatedPoemRoom;
  const roomGen = state.sonnet.roomGeneration;
  const rawMembers = el.sonnetRosterMembersInput.value.split('\n').map(s => s.trim()).filter(Boolean);
  const reqId = `roster-${Date.now()}`;

  let payload;
  try {
    payload = buildSonnetRosterPayload(gameId, poemRoom, roomGen, rawMembers, reqId);
  } catch (err) {
    showSonnetRosterResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.discovery;
  el.sonnetBtnSignRoster.disabled = true;
  el.sonnetBtnSignRoster.textContent = 'Dispatching Roster Consent...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);

    receiptEngine.recordAction({
      requestId: reqId,
      actionType: 'roster',
      authenticatedDid: state.keypair.did,
      room: targetRoom,
      sequence: res.seq || null,
      httpStatus: res.status,
      gameId: gameId,
      actionStatus: res.ok ? 'TRANSPORT SUCCESS' : 'TRANSPORT FAILED'
    });

    if (res.ok) {
      state.sonnet.lastRosterReqId = reqId;
      showSonnetRosterResult('info', `Roster consent dispatched to /r/${targetRoom}. Awaiting referee verification of all member signatures.`);
      pollSonnetRoom(targetRoom);
    } else {
      showSonnetRosterResult('error', `Roster rejected by server. HTTP ${res.status}: ${res.text}`);
    }
    renderSonnetReceipts();
  } catch (err) {
    showSonnetRosterResult('error', `Transport error: ${err.message}`);
  } finally {
    state.sonnet.requestIdCounter++;
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Handle Withdraw Team Dispatch
 */
async function handleSonnetWithdrawTeam() {
  if (!state.keypair || !state.sonnet.gameId || !state.sonnet.allocatedPoemRoom || !state.sonnet.roomGeneration) return;

  const gameId = state.sonnet.gameId;
  const poemRoom = state.sonnet.allocatedPoemRoom;
  const roomGen = state.sonnet.roomGeneration;
  const reqId = `withdraw-${Date.now()}`;

  let payload;
  try {
    payload = buildSonnetWithdrawPayload(gameId, poemRoom, roomGen, reqId);
  } catch (err) {
    showSonnetRosterResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.discovery;
  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);
    if (res.ok) {
      showSonnetRosterResult('info', 'Withdrawal dispatched to referee.');
    }
  } catch (err) {
    showSonnetRosterResult('error', `Withdrawal failed: ${err.message}`);
  }
}

/**
 * Handle Candidate Word Advisory Check
 */
function handleSonnetCheckWord() {
  const word = (el.sonnetWordInput.value || '').trim();
  if (!word) {
    el.sonnetWordCheckResult.style.display = 'none';
    return;
  }

  const activeDid = state.keypair ? state.keypair.did : '';
  const validation = validateCandidateWord(activeDid, word);

  el.sonnetWordCheckResult.style.display = 'block';
  el.sonnetWordCheckResult.innerHTML = `
    <div class="sonnet-proof-header">Advisory Mechanical Check for "${escapeHtml(word)}"</div>
    <div class="sonnet-proof-row">
      <span>DID Letter Compatibility:</span>
      <span class="${validation.didCompatible ? 'badge-accepted' : 'badge-rejected'}">${validation.didCompatible ? 'Compatible (All letters in DID)' : 'Missing letters: ' + validation.missingLetters.join(', ')}</span>
    </div>
    <div class="sonnet-proof-row">
      <span>Frozen CMUdict Syllables:</span>
      <span class="${validation.inDictionary ? 'badge-accepted' : 'badge-rejected'}">${validation.inDictionary ? validation.syllables + ' syllable(s)' : 'Not in frozen dictionary'}</span>
    </div>
    <div class="sonnet-proof-row">
      <span>Contest Eligibility:</span>
      <span class="${validation.valid ? 'badge-accepted' : 'badge-rejected'}">${validation.valid ? 'Valid candidate word' : 'Does not satisfy local rules'}</span>
    </div>
  `;

  updateSonnetStateUI();
}

/**
 * Handle Word Proposal Dispatch (Strictly Gated by Authoritative State)
 */
async function handleSonnetSendWordProposal() {
  if (!state.keypair) return;

  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;
  const gameId = state.sonnet.gameId;
  const poemRoom = state.sonnet.allocatedPoemRoom;
  const word = (el.sonnetWordInput.value || '').trim();

  // Strict check on authoritative values
  if (!state.sonnet.roomGeneration || state.sonnet.currentVersion === null || !state.sonnet.previousStateHash) {
    showSonnetWordResult('error', 'Cannot propose word: Authoritative version, generation, or state hash is missing from referee receipts.');
    return;
  }

  // Consecutive turn prohibition
  if (state.sonnet.lastContributor && state.sonnet.lastContributor.toLowerCase() === state.keypair.did.toLowerCase()) {
    showSonnetWordResult('error', 'Consecutive turn prohibited: You were the last accepted contributor.');
    return;
  }

  const reqId = `word-${state.sonnet.currentVersion}-${Date.now()}`;
  let payload;
  try {
    payload = buildSonnetWordPayload(
      contestId,
      gameId,
      state.sonnet.roomGeneration,
      state.sonnet.currentVersion,
      state.sonnet.previousStateHash,
      word,
      reqId
    );
  } catch (err) {
    showSonnetWordResult('error', err.message);
    return;
  }

  el.sonnetBtnSendWord.disabled = true;
  el.sonnetBtnSendWord.textContent = 'Dispatching Signed Word...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, poemRoom, payload);

    receiptEngine.recordAction({
      requestId: reqId,
      actionType: 'word',
      authenticatedDid: state.keypair.did,
      room: poemRoom,
      sequence: res.seq || null,
      httpStatus: res.status,
      contestId: contestId,
      gameId: gameId,
      roomGeneration: state.sonnet.roomGeneration,
      version: state.sonnet.currentVersion,
      stateHash: state.sonnet.previousStateHash,
      actionStatus: res.ok ? 'TRANSPORT SUCCESS' : 'TRANSPORT FAILED'
    });

    if (res.ok) {
      state.sonnet.lastWordReqId = reqId;
      showSonnetWordResult('info', `Word proposal "${word}" dispatched to /r/${poemRoom}. Transport success. Awaiting authoritative referee acceptance receipt.`);
      el.sonnetWordInput.value = '';
      pollSonnetRoom(poemRoom);
    } else {
      showSonnetWordResult('error', `Server rejected word proposal. HTTP ${res.status}: ${res.text}`);
    }
    renderSonnetReceipts();
  } catch (err) {
    showSonnetWordResult('error', `Transport error: ${err.message}`);
  } finally {
    state.sonnet.requestIdCounter++;
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Handle Submission Dispatch (Strictly Requires Frozen Completed Poem)
 */
async function handleSonnetSendSubmission() {
  if (!state.keypair) return;

  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;
  const gameId = state.sonnet.gameId;
  const poemRoom = state.sonnet.allocatedPoemRoom;
  const xPosts = el.sonnetXPostIds.value.split(',').map(s => s.trim()).filter(Boolean);

  const poemValidation = validatePoemSyllables(state.sonnet.words);
  if (!poemValidation.valid) {
    showSonnetSubmitResult('error', 'Poem must have exactly 14 lines with exactly 10 syllables per line to submit.');
    return;
  }

  if (!state.sonnet.poemSha256 || !state.sonnet.roomGeneration || state.sonnet.currentVersion === null) {
    showSonnetSubmitResult('error', 'Missing authoritative submission parameters.');
    return;
  }

  const reqId = `sub-${Date.now()}`;
  let payload;
  try {
    payload = buildSonnetSubmitPayload(
      contestId,
      gameId,
      poemRoom,
      state.sonnet.roomGeneration,
      state.sonnet.currentVersion,
      state.sonnet.poemSha256,
      xPosts,
      reqId
    );
  } catch (err) {
    showSonnetSubmitResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.submissions;
  el.sonnetBtnSendSubmission.disabled = true;
  el.sonnetBtnSendSubmission.textContent = 'Dispatching Submission...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);

    receiptEngine.recordAction({
      requestId: reqId,
      actionType: 'submit',
      authenticatedDid: state.keypair.did,
      room: targetRoom,
      sequence: res.seq || null,
      httpStatus: res.status,
      contestId: contestId,
      gameId: gameId,
      stateHash: state.sonnet.poemSha256,
      actionStatus: res.ok ? 'TRANSPORT SUCCESS' : 'TRANSPORT FAILED'
    });

    if (res.ok) {
      state.sonnet.submissionPending = true;
      state.sonnet.lastSubmitReqId = reqId;
      showSonnetSubmitResult('info', `Submission dispatched to /r/${targetRoom}. Awaiting referee verification receipt.`);
      pollSonnetRoom(targetRoom);
    } else {
      showSonnetSubmitResult('error', `Server rejected submission. HTTP ${res.status}: ${res.text}`);
    }
    renderSonnetReceipts();
  } catch (err) {
    showSonnetSubmitResult('error', `Transport error: ${err.message}`);
  } finally {
    state.sonnet.requestIdCounter++;
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Handle Ballot Dispatch (Strictly Requires Accepted Voter Role)
 */
async function handleSonnetSendBallot() {
  if (!state.keypair) return;

  if (state.sonnet.role !== 'voter' || !state.sonnet.registrationAccepted) {
    showSonnetBallotResult('error', 'Only verified registered Voters can cast ballots under official contest rules.');
    return;
  }

  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;
  const entryId = el.sonnetBallotEntryId.value.trim();
  const reqId = el.sonnetBallotReqId.value.trim() || `ballot-${Date.now()}`;

  if (!entryId) {
    showSonnetBallotResult('error', 'Enter the target submitted entry ID.');
    return;
  }

  let payload;
  try {
    payload = buildSonnetBallotPayload(contestId, state.keypair.did, entryId, reqId);
  } catch (err) {
    showSonnetBallotResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.votes;
  el.sonnetBtnSendBallot.disabled = true;
  el.sonnetBtnSendBallot.textContent = 'Casting Signed Ballot...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);

    receiptEngine.recordAction({
      requestId: reqId,
      actionType: 'ballot',
      authenticatedDid: state.keypair.did,
      room: targetRoom,
      sequence: res.seq || null,
      httpStatus: res.status,
      contestId: contestId,
      actionStatus: res.ok ? 'TRANSPORT SUCCESS' : 'TRANSPORT FAILED'
    });

    if (res.ok) {
      state.sonnet.ballotPending = true;
      state.sonnet.lastBallotReqId = reqId;
      showSonnetBallotResult('info', `Ballot dispatched to /r/${targetRoom}. Awaiting referee receipt.`);
      pollSonnetRoom(targetRoom);
    } else {
      showSonnetBallotResult('error', `Server rejected ballot. HTTP ${res.status}: ${res.text}`);
    }
    renderSonnetReceipts();
  } catch (err) {
    showSonnetBallotResult('error', `Transport error: ${err.message}`);
  } finally {
    state.sonnet.requestIdCounter++;
    updateSonnetStateUI();
    updateSonnetPreviews();
  }
}

/**
 * Handle Prize Claim Dispatch (Strictly Requires Authorized Winner State)
 */
async function handleSonnetSendClaim() {
  if (!state.keypair) return;

  if (!state.sonnet.prizeAuthorized) {
    showSonnetClaimResult('error', 'Cannot claim: Prize authorization receipt has not been issued by the contest referee.');
    return;
  }

  const contestId = state.sonnet.contestId || SONNET_CONFIG.defaultContestId;
  if (!state.sonnet.gameId) {
    showSonnetClaimResult('error', 'Cannot claim: No referee-assigned game ID.');
    return;
  }
  const gameId = state.sonnet.gameId;
  const payoutAddress = el.sonnetClaimDestination.value.trim();
  const reqId = `claim-${Date.now()}`;

  let payload;
  try {
    payload = buildSonnetClaimPayload(contestId, gameId, payoutAddress, reqId);
  } catch (err) {
    showSonnetClaimResult('error', err.message);
    return;
  }

  const targetRoom = SONNET_CONFIG.rooms.registration;
  el.sonnetBtnSendClaim.disabled = true;
  el.sonnetBtnSendClaim.textContent = 'Dispatching Claim...';

  try {
    const res = await dispatchSignedMessage(nacl, state.keypair, targetRoom, payload);
    if (res.ok) {
      state.sonnet.claimPending = true;
      state.sonnet.lastClaimReqId = reqId;
      showSonnetClaimResult('info', `Prize claim dispatched to /r/${targetRoom}. Awaiting referee payout receipt.`);
      pollSonnetRoom(targetRoom);
    } else {
      showSonnetClaimResult('error', `Server rejected claim. HTTP ${res.status}: ${res.text}`);
    }
  } catch (err) {
    showSonnetClaimResult('error', `Transport error: ${err.message}`);
  } finally {
    updateSonnetStateUI();
  }
}

/**
 * Render Sonnet 14-line meter cards with Quatrain / Couplet stanza breakdown
 */
function renderSonnetPoemLines() {
  if (!el.sonnetPoemLinesList) return;

  const poemValidation = validatePoemSyllables(state.sonnet.words);
  let html = '';

  const stanzaTitles = {
    0: 'Quatrain 1 (Lines 1–4)',
    4: 'Quatrain 2 (Lines 5–8)',
    8: 'Quatrain 3 (Lines 9–12)',
    12: 'Couplet (Lines 13–14)'
  };

  for (let i = 0; i < 14; i++) {
    if (stanzaTitles[i]) {
      html += `<div class="stanza-header">${stanzaTitles[i]}</div>`;
    }

    const lineData = poemValidation.lines[i] || { syllables: 0, words: [], valid: true };
    const meterPercent = Math.min(100, Math.round((lineData.syllables / 10) * 100));
    const wordsText = lineData.words && lineData.words.length > 0 ? lineData.words.join(' ') : '';

    html += `
      <div class="meter-line-item ${lineData.syllables === 10 ? 'complete-row' : ''}">
        <span class="meter-line-num">L${i + 1}</span>
        <div class="meter-line-content">
          <div class="meter-words">${wordsText ? escapeHtml(wordsText) : '<span class="meter-words-empty">Empty line</span>'}</div>
          <div class="meter-bar-container">
            <div class="meter-bar-fill ${lineData.syllables > 10 ? 'overflow' : lineData.syllables === 10 ? 'full' : ''}" style="width: ${meterPercent}%;"></div>
          </div>
        </div>
        <span class="meter-line-val ${lineData.syllables === 10 ? 'complete' : ''}">${lineData.syllables}/10</span>
      </div>
    `;
  }

  el.sonnetPoemLinesList.innerHTML = html;
  el.sonnetMeterSummary.textContent = `${poemValidation.totalSyllables} / 140 Syllables`;
  el.sonnetStatSyllables.textContent = `${poemValidation.totalSyllables} / 140`;

  const canonical = formatCanonicalPoem(state.sonnet.words);
  el.sonnetCanonicalTextArea.value = canonical || 'Waiting for referee accepted words...';

  if (poemValidation.valid) {
    calculatePoemSha256(canonical).then((sha) => {
      state.sonnet.poemSha256 = sha;
      el.sonnetPoemShaDisplay.textContent = sha;
      el.sonnetPoemShaDisplay.className = 'readout-text';
      el.sonnetBtnCopyPoem.disabled = false;
      el.sonnetBtnCopyAttribution.disabled = false;
      el.sonnetPoemStateBadge.textContent = 'Poem Complete';
      el.sonnetPoemStateBadge.className = 'step-status-pill completed';
      updateSonnetStateUI();
      updateSonnetPreviews();
    });
  } else {
    state.sonnet.poemSha256 = null; // Strictly null if not complete
    el.sonnetPoemShaDisplay.textContent = 'Poem not yet frozen (requires 14 lines x 10 syllables)';
    el.sonnetPoemShaDisplay.className = 'readout-text empty';
    el.sonnetBtnCopyPoem.disabled = true;
    el.sonnetBtnCopyAttribution.disabled = true;
    el.sonnetPoemStateBadge.textContent = state.sonnet.words.length > 0 ? 'In Progress' : 'Waiting for Referee';
    el.sonnetPoemStateBadge.className = 'step-status-pill';
  }
}

/**
 * Render Session Receipts in the Referee Inspector
 */
function renderSonnetReceipts() {
  if (!el.sonnetReceiptsList) return;

  const records = receiptEngine.getAllRecords();
  if (records.length === 0) {
    el.sonnetReceiptsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No receipts recorded yet</div>
        <div class="empty-desc">All protocol actions will record their transport responses and signed referee receipts here.</div>
      </div>
    `;
    return;
  }

  let html = '';
  records.slice(-20).reverse().forEach((r) => {
    const isRefereeAccepted = r.refereeAccepted;
    const isTransportSuccess = r.transportSuccess;
    const badgeClass = isRefereeAccepted ? 'badge-accepted' : isTransportSuccess ? 'badge-sent' : 'badge-rejected';
    const statusText = isRefereeAccepted ? 'REFEREE ACCEPTED' : isTransportSuccess ? 'TRANSPORT SUCCESS' : 'FAILED';
    const seqStr = r.sequence !== null ? `#${r.sequence}` : 'Seq: Pending';

    html += `
      <div class="receipt-item">
        <div class="receipt-meta">
          <span class="mono-xs">${escapeHtml(r.requestId || 'req')}</span>
          <span class="receipt-badge ${badgeClass}">${statusText}</span>
        </div>
        <div class="mono-xs" style="color: var(--text-muted); margin-top: 2px;">
          Room: /r/${escapeHtml(r.room || '')} &bull; ${seqStr} &bull; HTTP ${r.httpStatus || 200} &bull; ${new Date(r.transportTimestamp).toLocaleTimeString()}
        </div>
        ${r.stateHash ? `<div class="mono-xs" style="color: var(--text-muted); margin-top: 2px; word-break: break-all;">Hash: ${escapeHtml(r.stateHash)}</div>` : ''}
      </div>
    `;
  });

  el.sonnetReceiptsList.innerHTML = html;
}

function showSonnetRegResult(type, message) {
  el.sonnetRegResult.className = `result-callout ${type}`;
  el.sonnetRegResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetRegResult.style.display = 'flex';
}

function showSonnetTeamResult(type, message) {
  el.sonnetTeamReqResult.className = `result-callout ${type}`;
  el.sonnetTeamReqResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetTeamReqResult.style.display = 'flex';
}

function showSonnetRosterResult(type, message) {
  el.sonnetRosterResult.className = `result-callout ${type}`;
  el.sonnetRosterResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetRosterResult.style.display = 'flex';
}

function showSonnetWordResult(type, message) {
  el.sonnetWordResult.className = `result-callout ${type}`;
  el.sonnetWordResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetWordResult.style.display = 'flex';
}

function showSonnetSubmitResult(type, message) {
  el.sonnetSubmitResult.className = `result-callout ${type}`;
  el.sonnetSubmitResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetSubmitResult.style.display = 'flex';
}

function showSonnetBallotResult(type, message) {
  el.sonnetBallotResult.className = `result-callout ${type}`;
  el.sonnetBallotResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetBallotResult.style.display = 'flex';
}

function showSonnetClaimResult(type, message) {
  el.sonnetClaimResult.className = `result-callout ${type}`;
  el.sonnetClaimResult.innerHTML = `<div class="result-body">${escapeHtml(message)}</div>`;
  el.sonnetClaimResult.style.display = 'flex';
}

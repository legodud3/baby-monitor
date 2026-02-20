// DOM Elements
const landingScreen = document.getElementById('landing-screen');
const monitorScreen = document.getElementById('monitor-screen');
const btnChild = document.getElementById('btn-child');
const btnParent = document.getElementById('btn-parent');
const btnConnect = document.getElementById('btn-connect');
const roomIdInput = document.getElementById('room-id');
const roleDisplay = document.getElementById('role-display');
const statusIndicator = document.getElementById('connection-status');
const childControls = document.getElementById('child-controls');
const parentControls = document.getElementById('parent-controls');
const dimOverlay = document.getElementById('dim-overlay');
const btnStop = document.getElementById('btn-stop');
const btnListen = document.getElementById('btn-listen');
const audioStatus = document.getElementById('audio-status');
const vadStatus = document.getElementById('vad-status');
const wakeLockVideo = document.getElementById('wake-lock-video');
const debugLog = document.getElementById('debug-log');
const stateSummaryEl = document.getElementById('state-summary');
const statusText = document.getElementById('status-text');
const btnDimParent = document.getElementById('btn-dim-parent');
const whiteNoiseToggle = document.getElementById('white-noise-toggle');
const whiteNoiseVolumeInput = document.getElementById('white-noise-volume');
const whiteNoiseTimerSelect = document.getElementById('white-noise-timer');
const whiteNoiseAudio = document.getElementById('white-noise-audio');
const whiteNoiseStatus = document.getElementById('white-noise-status');
const whiteNoiseRemaining = document.getElementById('white-noise-remaining');
const whiteNoiseCta = document.getElementById('white-noise-cta');

// State
let role = null;
let selectedRole = null;
let roomId = null;
let peer = null;
let currentCall = null;
let localStream = null;
let wakeLock = null;
let audioCtx = null;
let gainNode = null;
let analyser = null;
let reconnectInterval = null;
let vadInterval = null;
let lastNoiseTime = 0;
let isTransmitting = true;
let vadTrack = null;
let pendingRemoteStream = null;
let audioUnlocked = false;
let visualizerRafId = null;
let visualizerActive = false;
let statsInterval = null;
let statsLoopRunning = false;
let lastStats = null;
let lastAudioEnergy = null;
let lastAudioEnergyTs = null;
let debugPanel = null;
let latestNetworkLabel = 'Network: Unknown';
let dataConn = null;
let parentDataConns = new Map();
let childCalls = new Map();
let pendingChildCalls = [];
let parentRetryTimeout = null;
let parentRetryDelay = 3000;
let peerReconnectTimer = null;
let silentStream = null;
let silentAudioCtx = null;
let lastElevatedTs = null;
let infantState = 'zzz';
let stateSummaryInterval = null;
let elevatedStartTsForAlert = null;
let elevatedCooldownUntil = 0;
let noiseFloorDb = null;
let elevatedStartTs = null;
let currentInfantState = 'zzz';
let lastVadSampleTs = null;
let lastVisualizerPrefix = null;
let sendStream = null;
let sendTrack = null;
let micGainNode = null;
let transmitMixNode = null;
let whiteNoiseSourceNode = null;
let whiteNoisePlaybackGain = null;
let whiteNoiseCancelGain = null;
const MIC_BOOST_GAIN = 3.0;
let gateStartTs = null;
let isDimmed = false;
let connectionState = 'disconnected';
let whiteNoiseEnabled = false;
let whiteNoiseVolume = 0.5;
let whiteNoiseDurationMs = null;
let whiteNoiseStartedAt = null;
let whiteNoiseStopTimeout = null;
let whiteNoiseUiInterval = null;
let whiteNoiseAutoplayBlocked = false;

// Constants
const MAX_LOG_ENTRIES = 200;
const STATS_INTERVAL_MS = 2500;
const SILENCE_WARN_MS = 12000;
const NETWORK_CONFIG = Object.assign({
    lowBandwidth: false,
    bitrateLevelsKbps: [32, 48, 64],
    lowBandwidthLevelsKbps: [12, 24, 48]
}, window.NETWORK_CONFIG || {});
const BITRATE_LEVELS = (NETWORK_CONFIG.lowBandwidth ? NETWORK_CONFIG.lowBandwidthLevelsKbps : NETWORK_CONFIG.bitrateLevelsKbps)
    .map(kbps => Math.max(8, kbps) * 1000);
const BITRATE_DEFAULT_INDEX = Math.min(2, BITRATE_LEVELS.length - 1);
const BITRATE_STEP_DOWN_AFTER = 3; // consecutive bad intervals
const BITRATE_STEP_UP_AFTER = 4; // consecutive good intervals

const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }
];

const PEER_CONFIG = {
    debug: 2,
    secure: true,
    config: {
        iceServers: ICE_SERVERS
    }
};
const VAD_HOLD_TIME = 2000; // ms to keep mic open after noise stops
const CRY_CONFIG = Object.assign({
    sustainedSeconds: 1.5,
    minDbAboveNoise: 12,
    cooldownSeconds: 10,
    noiseFloorWindowSeconds: 8,
    noiseFloorUpdateMarginDb: 3
}, window.CRY_CONFIG || {});
const VAD_MIN_DB_ABOVE_NOISE = Math.max(6, CRY_CONFIG.minDbAboveNoise - 4);
const WHITE_NOISE_CANCEL_GAIN = 1.0;
const STATE_THRESHOLDS = {
    stirringDbAboveNoise: Math.max(4, VAD_MIN_DB_ABOVE_NOISE - 2),
    needsCareDbAboveNoise: CRY_CONFIG.minDbAboveNoise,
    settleSeconds: 30,
    stirringSeconds: 2,
    needsCareSustainedSeconds: CRY_CONFIG.sustainedSeconds
};

const STORAGE_PREFIX = 'kgbaby';
const STORAGE_VERSION = 'v1';

function storageKey(roomId, role) {
    return `${STORAGE_PREFIX}:${STORAGE_VERSION}:${roomId}:${role}`;
}

function loadStoredState(roomId, role) {
    if (!roomId || !role) return {};
    try {
        const raw = localStorage.getItem(storageKey(roomId, role));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch (e) {
        return {};
    }
}

function saveStoredState(roomId, role, patch) {
    if (!roomId || !role) return;
    try {
        const existing = loadStoredState(roomId, role);
        const next = Object.assign({}, existing, patch);
        localStorage.setItem(storageKey(roomId, role), JSON.stringify(next));
    } catch (e) {
        // Ignore storage errors (private mode, quota, etc.)
    }
}

function clearStoredElevatedTimestamp(roomId, role) {
    if (!roomId || !role) return;
    try {
        const existing = loadStoredState(roomId, role);
        if (!existing || typeof existing !== 'object') {
            localStorage.removeItem(storageKey(roomId, role));
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(existing, 'lastElevatedTs') &&
            !Object.prototype.hasOwnProperty.call(existing, 'lastCryTs')) return;
        const next = Object.assign({}, existing);
        delete next.lastElevatedTs;
        delete next.lastCryTs; // Backward compatibility from older versions
        if (Object.keys(next).length === 0) {
            localStorage.removeItem(storageKey(roomId, role));
        } else {
            localStorage.setItem(storageKey(roomId, role), JSON.stringify(next));
        }
    } catch (e) {
        // Ignore storage errors
    }
}

// Utility
function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const fullMsg = `[${time}] ${msg}`;
    console.log(fullMsg);
    if (debugLog) {
        const p = document.createElement('div');
        p.textContent = fullMsg;
        p.style.color = isError ? '#ff5252' : '#69f0ae';
        p.style.borderBottom = '1px solid #333';
        p.style.padding = '2px 0';
        debugLog.appendChild(p);
        while (debugLog.children.length > MAX_LOG_ENTRIES) {
            debugLog.removeChild(debugLog.firstChild);
        }
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseDurationValue(value) {
    if (value === 'infinite') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function selectRole(nextRole) {
    selectedRole = nextRole;
    btnChild.classList.toggle('selected', nextRole === 'child');
    btnParent.classList.toggle('selected', nextRole === 'parent');
    if (btnConnect) {
        btnConnect.textContent = nextRole === 'child' ? 'Connect as Child' : 'Connect as Parent';
    }
    updateConnectState();
}

function updateConnectState() {
    if (!btnConnect) return;
    const roomName = roomIdInput.value.trim();
    const ready = !!roomName && !!selectedRole;
    btnConnect.disabled = !ready;
}

// Event Listeners
btnChild.addEventListener('click', () => selectRole('child'));
btnParent.addEventListener('click', () => selectRole('parent'));
if (btnConnect) btnConnect.addEventListener('click', () => {
    if (!selectedRole) {
        alert('Please select a device role.');
        return;
    }
    startSession(selectedRole);
});
btnStop.addEventListener('click', stopSession);
btnListen.addEventListener('click', resumeAudioContext);
if (btnDimParent) btnDimParent.addEventListener('click', toggleParentDim);
if (roomIdInput) roomIdInput.addEventListener('input', updateConnectState);
if (whiteNoiseToggle) whiteNoiseToggle.addEventListener('click', toggleParentWhiteNoise);
if (whiteNoiseVolumeInput) whiteNoiseVolumeInput.addEventListener('input', handleWhiteNoiseVolumeInput);
if (whiteNoiseTimerSelect) whiteNoiseTimerSelect.addEventListener('change', handleWhiteNoiseTimerChange);
if (whiteNoiseCta) whiteNoiseCta.addEventListener('click', () => attemptWhiteNoisePlayback());

updateConnectState();

let lastDimTap = 0;
dimOverlay.addEventListener('click', (e) => {
    if (role !== 'child') return;
    const now = Date.now();
    const tapLength = now - lastDimTap;
    if (tapLength < 500 && tapLength > 0) {
        setDimOverlay(false);
        sendDimStateFromChild(false);
        e.preventDefault();
    }
    lastDimTap = now;
});

// Initialization
async function startSession(selectedRole) {
    try {
        configureTurnIfPresent();
        ensureDebugPanel();
        audioUnlocked = false;
        pendingRemoteStream = null;
        isDimmed = false;
        lastElevatedTs = null;
        infantState = 'zzz';
        elevatedStartTsForAlert = null;
        elevatedCooldownUntil = 0;
        noiseFloorDb = null;
        elevatedStartTs = null;
        currentInfantState = 'zzz';
        lastVadSampleTs = null;
        gateStartTs = null;
        if (stateSummaryInterval) {
            clearInterval(stateSummaryInterval);
            stateSummaryInterval = null;
        }
        if (parentRetryTimeout) {
            clearTimeout(parentRetryTimeout);
            parentRetryTimeout = null;
            parentRetryDelay = 3000;
        }
        if (dataConn) {
            dataConn.close();
            dataConn = null;
        }
        if (parentDataConns.size > 0) {
            parentDataConns.forEach(conn => {
                try { conn.close(); } catch (e) {}
            });
            parentDataConns.clear();
        }
        if (childCalls.size > 0) {
            childCalls.forEach(call => {
                try { call.close(); } catch (e) {}
            });
            childCalls.clear();
        }
        pendingChildCalls = [];
        silentStream = null;
        silentAudioCtx = null;

        const roomName = roomIdInput.value.trim();
        if (!roomName) {
            alert('Please enter a Room Name');
            return;
        }

        debugLog.innerHTML = ''; // Clear previous logs
        log("Initializing...", false);

        // Initialize AudioContext on user gesture
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // Optional: for some browsers we might need to resume it immediately
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }

        // Check if PeerJS loaded
        if (typeof Peer === 'undefined') {
            log("Error: PeerJS library not loaded. Check Internet connection.", true);
            return;
        }

        // IOS WAKE LOCK HACK: Play hidden video (Non-blocking)
        wakeLockVideo.play().then(() => {
            console.log('Video Wake Lock Active');
        }).catch((err) => {
            console.warn('Video Wake Lock Failed:', err);
            // This is non-critical, so we don't stop
        });

        role = selectedRole;
        roomId = roomName.toLowerCase().replace(/[^a-z0-9]/g, ''); // Sanitize
        
        // Check if ID is empty after sanitize
        if (!roomId) {
            log("Invalid Room Name. Use letters/numbers only.", true);
            return;
        }
        
        const stored = loadStoredState(roomId, role);
        if (role === 'parent' && typeof stored.lastElevatedTs === 'number') {
            lastElevatedTs = stored.lastElevatedTs;
        } else if (role === 'parent' && typeof stored.lastCryTs === 'number') {
            lastElevatedTs = stored.lastCryTs; // Backward compatibility from older versions
        }
        if (role === 'parent' && typeof stored.infantState === 'string') {
            infantState = stored.infantState;
        }
        if (typeof stored.whiteNoiseEnabled === 'boolean') {
            whiteNoiseEnabled = stored.whiteNoiseEnabled;
        }
        if (typeof stored.whiteNoiseVolume !== 'undefined') {
            const storedVolume = Number(stored.whiteNoiseVolume);
            if (Number.isFinite(storedVolume)) {
                whiteNoiseVolume = clamp(storedVolume, 0, 1);
            }
        }
        if (Object.prototype.hasOwnProperty.call(stored, 'whiteNoiseDurationMs')) {
            const storedDuration = stored.whiteNoiseDurationMs;
            if (storedDuration === null) {
                whiteNoiseDurationMs = null;
            } else {
                const numeric = Number(storedDuration);
                whiteNoiseDurationMs = Number.isFinite(numeric) ? numeric : null;
            }
        }
        if (typeof stored.whiteNoiseStartedAt === 'number') {
            whiteNoiseStartedAt = stored.whiteNoiseStartedAt;
        }

        if (role === 'child') {
            initChild();
        } else {
            initParent();
        }

        requestWakeLock();
        setStatusText('disconnected');
    } catch (e) {
        console.error(e);
        log(`App Error: ${e.message}`, true);
    }
}

function switchToMonitor() {
    landingScreen.classList.add('hidden');
    monitorScreen.classList.remove('hidden');
    roleDisplay.textContent = role === 'child' ? 'Child Unit' : 'Parent Unit';
    if (role === 'child') {
        childControls.classList.remove('hidden');
        if (stateSummaryEl) stateSummaryEl.classList.add('hidden');
        if (vadStatus) {
            vadStatus.textContent = 'Microphone Active';
            vadStatus.style.color = '#69f0ae';
        }
    } else {
        parentControls.classList.remove('hidden');
        if (stateSummaryEl) {
            stateSummaryEl.classList.remove('hidden');
            updateStateSummaryDisplay();
            ensureStateSummaryInterval();
        }
        updateSegmentedButtons();
    }
    applyWhiteNoiseStateFromStorage();
}

function stopSession() {
    if (peer) peer.destroy();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (vadTrack) vadTrack.stop();
    if (sendStream) sendStream.getTracks().forEach(track => track.stop());
    if (wakeLock) wakeLock.release();
    if (reconnectInterval) clearInterval(reconnectInterval);
    if (vadInterval) clearInterval(vadInterval);
    if (statsInterval) clearInterval(statsInterval);
    if (stateSummaryInterval) clearInterval(stateSummaryInterval);
    if (dataConn) dataConn.close();
    if (parentDataConns.size > 0) {
        parentDataConns.forEach(conn => {
            try { conn.close(); } catch (e) {}
        });
        parentDataConns.clear();
    }
    if (childCalls.size > 0) {
        childCalls.forEach(call => {
            try { call.close(); } catch (e) {}
        });
        childCalls.clear();
    }
    pendingChildCalls = [];
    if (parentRetryTimeout) clearTimeout(parentRetryTimeout);
    parentRetryTimeout = null;
    parentRetryDelay = 3000;
    if (peerReconnectTimer) clearTimeout(peerReconnectTimer);
    peerReconnectTimer = null;
    stopVisualizer();
    teardownAudioGraph();
    clearWhiteNoiseTimers();
    stopWhiteNoisePlayback();
    if (whiteNoiseSourceNode) {
        try { whiteNoiseSourceNode.disconnect(); } catch (e) {}
    }
    if (whiteNoisePlaybackGain) {
        try { whiteNoisePlaybackGain.disconnect(); } catch (e) {}
    }
    if (whiteNoiseCancelGain) {
        try { whiteNoiseCancelGain.disconnect(); } catch (e) {}
    }
    whiteNoiseSourceNode = null;
    whiteNoisePlaybackGain = null;
    whiteNoiseCancelGain = null;
    transmitMixNode = null;
    if (audioCtx) audioCtx.close();
    if (silentAudioCtx) silentAudioCtx.close();
    silentStream = null;
    silentAudioCtx = null;

    if (role === 'parent') {
        clearStoredElevatedTimestamp(roomId, 'parent');
    }
    
    location.reload();
}

// Wake Lock
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            log('Screen Wake Lock active', false);
            wakeLock.addEventListener('release', () => {
                log('Screen Wake Lock released', true);
            });
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
            log(`WakeLock Error: ${err.message}`, true);
        }
    } else {
        log('WakeLock API not supported', true);
    }
}

function setDimOverlay(enabled) {
    isDimmed = enabled;
    if (enabled) {
        dimOverlay.classList.remove('hidden');
        dimOverlay.innerHTML = '<p>Double-tap to wake</p>';
        stopVisualizer();
    } else {
        dimOverlay.classList.add('hidden');
        if (analyser && lastVisualizerPrefix) {
            visualize(lastVisualizerPrefix);
        }
    }
}

function updateWhiteNoiseControls() {
    if (whiteNoiseToggle) {
        whiteNoiseToggle.textContent = whiteNoiseEnabled ? 'Stop White Noise' : 'Start White Noise';
    }
    if (whiteNoiseVolumeInput) {
        whiteNoiseVolumeInput.value = Math.round(clamp(whiteNoiseVolume, 0, 1) * 100).toString();
    }
    if (whiteNoiseTimerSelect) {
        whiteNoiseTimerSelect.value = whiteNoiseDurationMs === null ? 'infinite' : String(whiteNoiseDurationMs);
    }
}

function updateWhiteNoiseStatus() {
    if (!whiteNoiseStatus) return;
    if (!whiteNoiseEnabled) {
        whiteNoiseStatus.classList.add('hidden');
        if (whiteNoiseRemaining) whiteNoiseRemaining.textContent = '';
        return;
    }
    whiteNoiseStatus.classList.remove('hidden');
    if (!whiteNoiseRemaining) return;
    if (whiteNoiseDurationMs === null) {
        whiteNoiseRemaining.textContent = '(∞)';
        return;
    }
    const elapsed = whiteNoiseStartedAt ? (Date.now() - whiteNoiseStartedAt) : 0;
    const remaining = whiteNoiseDurationMs - elapsed;
    whiteNoiseRemaining.textContent = `(${formatRemaining(remaining)})`;
}

function updateWhiteNoiseCta() {
    if (!whiteNoiseCta) return;
    const shouldShow = whiteNoiseEnabled && whiteNoiseAutoplayBlocked;
    whiteNoiseCta.classList.toggle('hidden', !shouldShow);
}

function clearWhiteNoiseTimers() {
    if (whiteNoiseStopTimeout) clearTimeout(whiteNoiseStopTimeout);
    if (whiteNoiseUiInterval) clearInterval(whiteNoiseUiInterval);
    whiteNoiseStopTimeout = null;
    whiteNoiseUiInterval = null;
}

function ensureWhiteNoiseAudioGraph() {
    if (!whiteNoiseAudio || role !== 'child') return;
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!whiteNoiseSourceNode) {
        whiteNoiseSourceNode = audioCtx.createMediaElementSource(whiteNoiseAudio);
        whiteNoisePlaybackGain = audioCtx.createGain();
        whiteNoiseCancelGain = audioCtx.createGain();
        whiteNoiseSourceNode.connect(whiteNoisePlaybackGain);
        whiteNoisePlaybackGain.connect(audioCtx.destination);
        whiteNoiseSourceNode.connect(whiteNoiseCancelGain);
        if (transmitMixNode) {
            whiteNoiseCancelGain.connect(transmitMixNode);
        }
    }
    updateWhiteNoiseGains();
}

function updateWhiteNoiseGains() {
    const volume = clamp(whiteNoiseVolume, 0, 1);
    if (whiteNoisePlaybackGain) {
        whiteNoisePlaybackGain.gain.value = volume;
    }
    if (whiteNoiseCancelGain) {
        whiteNoiseCancelGain.gain.value = whiteNoiseEnabled ? -volume * WHITE_NOISE_CANCEL_GAIN : 0;
    }
}

function startWhiteNoisePlayback() {
    if (!whiteNoiseAudio || role !== 'child') return;
    ensureWhiteNoiseAudioGraph();
    const playAttempt = whiteNoiseAudio.play();
    if (playAttempt && typeof playAttempt.then === 'function') {
        playAttempt.then(() => {
            whiteNoiseAutoplayBlocked = false;
            updateWhiteNoiseCta();
        }).catch(() => {
            whiteNoiseAutoplayBlocked = true;
            updateWhiteNoiseCta();
        });
    }
}

function stopWhiteNoisePlayback() {
    if (!whiteNoiseAudio || role !== 'child') return;
    whiteNoiseAudio.pause();
    whiteNoiseAudio.currentTime = 0;
    whiteNoiseAutoplayBlocked = false;
    updateWhiteNoiseGains();
    updateWhiteNoiseCta();
}

function scheduleWhiteNoiseStop() {
    clearWhiteNoiseTimers();
    if (!whiteNoiseEnabled || whiteNoiseDurationMs === null) {
        updateWhiteNoiseStatus();
        return;
    }
    const elapsed = whiteNoiseStartedAt ? (Date.now() - whiteNoiseStartedAt) : 0;
    const remaining = whiteNoiseDurationMs - elapsed;
    if (remaining <= 0) {
        handleWhiteNoiseAutoStop();
        return;
    }
    whiteNoiseStopTimeout = setTimeout(handleWhiteNoiseAutoStop, remaining);
    whiteNoiseUiInterval = setInterval(updateWhiteNoiseStatus, 1000);
    updateWhiteNoiseStatus();
}

function setWhiteNoiseState(next) {
    if (!next || typeof next !== 'object') return;
    if (typeof next.enabled === 'boolean') {
        whiteNoiseEnabled = next.enabled;
    }
    if (typeof next.volume === 'number') {
        whiteNoiseVolume = clamp(next.volume, 0, 1);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'durationMs')) {
        if (next.durationMs === null) {
            whiteNoiseDurationMs = null;
        } else if (typeof next.durationMs === 'number') {
            whiteNoiseDurationMs = next.durationMs;
        }
    }
    if (typeof next.startedAt === 'number') {
        whiteNoiseStartedAt = next.startedAt;
    }
    if (!whiteNoiseEnabled) {
        whiteNoiseStartedAt = null;
        whiteNoiseAutoplayBlocked = false;
    } else if (!whiteNoiseStartedAt) {
        whiteNoiseStartedAt = Date.now();
    }

    saveStoredState(roomId, role, {
        whiteNoiseEnabled,
        whiteNoiseVolume,
        whiteNoiseDurationMs,
        whiteNoiseStartedAt,
        updatedAt: Date.now()
    });

    updateWhiteNoiseControls();
    if (role === 'child') {
        if (whiteNoiseEnabled) {
            ensureTransmission(true);
            startWhiteNoisePlayback();
        } else {
            stopWhiteNoisePlayback();
        }
    }
    updateWhiteNoiseGains();
    scheduleWhiteNoiseStop();
    updateWhiteNoiseStatus();
    updateWhiteNoiseCta();
}

function handleWhiteNoiseAutoStop() {
    const wasEnabled = whiteNoiseEnabled;
    setWhiteNoiseState({ enabled: false });
    if (wasEnabled && role === 'child') {
        broadcastToParents({ type: 'white_noise', action: 'stop', source: 'timer' });
    }
}

function attemptWhiteNoisePlayback() {
    if (!whiteNoiseEnabled) return;
    startWhiteNoisePlayback();
}

function toggleParentWhiteNoise() {
    if (role !== 'parent') return;
    if (whiteNoiseEnabled) {
        setWhiteNoiseState({ enabled: false });
        sendWhiteNoisePayload({ type: 'white_noise', action: 'stop' });
        return;
    }
    setWhiteNoiseState({ enabled: true, startedAt: Date.now() });
    sendWhiteNoisePayload({
        type: 'white_noise',
        action: 'start',
        volume: whiteNoiseVolume,
        durationMs: whiteNoiseDurationMs,
        startedAt: whiteNoiseStartedAt
    });
}

function handleWhiteNoiseVolumeInput() {
    if (role !== 'parent' || !whiteNoiseVolumeInput) return;
    const raw = Number(whiteNoiseVolumeInput.value);
    if (!Number.isFinite(raw)) return;
    const nextVolume = clamp(raw / 100, 0, 1);
    setWhiteNoiseState({ volume: nextVolume });
    if (whiteNoiseEnabled) {
        sendWhiteNoisePayload({
            type: 'white_noise',
            action: 'start',
            volume: whiteNoiseVolume,
            durationMs: whiteNoiseDurationMs,
            startedAt: whiteNoiseStartedAt
        });
    }
}

function handleWhiteNoiseTimerChange() {
    if (role !== 'parent' || !whiteNoiseTimerSelect) return;
    const nextDuration = parseDurationValue(whiteNoiseTimerSelect.value);
    if (whiteNoiseEnabled) {
        setWhiteNoiseState({ durationMs: nextDuration, startedAt: Date.now() });
        sendWhiteNoisePayload({
            type: 'white_noise',
            action: 'start',
            volume: whiteNoiseVolume,
            durationMs: whiteNoiseDurationMs,
            startedAt: whiteNoiseStartedAt
        });
        return;
    }
    setWhiteNoiseState({ durationMs: nextDuration });
}

function sendWhiteNoisePayload(payload) {
    if (!payload || !payload.type) return;
    if (role === 'child') {
        broadcastToParents(payload);
        return;
    }
    if (dataConn && dataConn.open) {
        dataConn.send(payload);
    }
}

function handleWhiteNoiseMessage(data) {
    if (!data || data.type !== 'white_noise') return;
    if (data.action === 'start') {
        const volume = typeof data.volume === 'number' ? clamp(data.volume, 0, 1) : whiteNoiseVolume;
        let durationMs = whiteNoiseDurationMs;
        if (Object.prototype.hasOwnProperty.call(data, 'durationMs')) {
            if (data.durationMs === null) {
                durationMs = null;
            } else {
                const numeric = Number(data.durationMs);
                durationMs = Number.isFinite(numeric) ? numeric : whiteNoiseDurationMs;
            }
        }
        const startedAt = typeof data.startedAt === 'number' ? data.startedAt : Date.now();
        setWhiteNoiseState({ enabled: true, volume, durationMs, startedAt });
        return;
    }
    if (data.action === 'stop') {
        setWhiteNoiseState({ enabled: false });
    }
}

function applyWhiteNoiseStateFromStorage() {
    setWhiteNoiseState({
        enabled: whiteNoiseEnabled,
        volume: whiteNoiseVolume,
        durationMs: whiteNoiseDurationMs,
        startedAt: whiteNoiseStartedAt
    });
}

// PeerJS & Logic
function getPeerId(r) {
    return `babymonitor-${roomId}-${r}`;
}

function updateSegmentedButtons() {
    if (btnDimParent) {
        btnDimParent.textContent = isDimmed ? 'Wake Child Screen' : 'Dim Child Screen';
    }
}

function toggleParentDim() {
    isDimmed = !isDimmed;
    updateSegmentedButtons();
    sendDimState();
}

function broadcastToParents(payload) {
    if (parentDataConns.size === 0) return;
    parentDataConns.forEach(conn => {
        if (conn && conn.open) {
            conn.send(payload);
        }
    });
}


function sendDimState() {
    const payload = { type: 'dim', enabled: isDimmed };
    if (role === 'child') {
        broadcastToParents(payload);
        return;
    }
    if (dataConn && dataConn.open) {
        dataConn.send(payload);
    }
}

function sendDimStateFromChild(enabled) {
    if (role !== 'child') return;
    broadcastToParents({ type: 'dim', enabled, source: 'child' });
}

function setParentDimStateFromChild(enabled) {
    isDimmed = enabled;
    updateSegmentedButtons();
}


function ensureStateSummaryInterval() {
    if (stateSummaryInterval) return;
    stateSummaryInterval = setInterval(updateStateSummaryDisplay, 10000);
}

function getInfantStateLabel(state) {
    const labels = {
        zzz: 'Zzz',
        settled: 'Settled',
        stirring: 'Stirring',
        needsCare: 'Needs attention'
    };
    return labels[state] || labels.zzz;
}

function applyStateSummaryStyle() {
    if (!stateSummaryEl) return;
    stateSummaryEl.classList.remove('state-zzz', 'state-settled', 'state-stirring', 'state-needs-care');
    if (infantState === 'needsCare') stateSummaryEl.classList.add('state-needs-care');
    else if (infantState === 'stirring') stateSummaryEl.classList.add('state-stirring');
    else if (infantState === 'settled') stateSummaryEl.classList.add('state-settled');
    else stateSummaryEl.classList.add('state-zzz');
}

function updateStateSummaryDisplay() {
    if (!stateSummaryEl) return;
    applyStateSummaryStyle();
    if (!lastElevatedTs) {
        stateSummaryEl.textContent = `State: ${getInfantStateLabel(infantState)}`;
        return;
    }
    const elapsedSec = Math.floor((Date.now() - lastElevatedTs) / 1000);
    let text = 'just now';
    if (elapsedSec >= 10 && elapsedSec < 60) {
        text = `${elapsedSec}s ago`;
    } else if (elapsedSec >= 60 && elapsedSec < 3600) {
        const mins = Math.floor(elapsedSec / 60);
        text = `${mins}m ago`;
    } else if (elapsedSec >= 3600) {
        const hours = Math.floor(elapsedSec / 3600);
        const mins = Math.floor((elapsedSec % 3600) / 60);
        text = `${hours}h ${mins}m ago`;
    }
    stateSummaryEl.textContent = `State: ${getInfantStateLabel(infantState)} · Elevated ${text}`;
}

function handleElevatedAudioMessage(data) {
    if (!data || data.type !== 'elevated') return;
    const ts = typeof data.ts === 'number' ? data.ts : Date.now();
    lastElevatedTs = ts;
    infantState = 'needsCare';
    saveStoredState(roomId, 'parent', { lastElevatedTs, infantState, updatedAt: Date.now() });
    updateStateSummaryDisplay();
    ensureStateSummaryInterval();
}

function handleStateMessage(data) {
    if (!data || data.type !== 'state') return;
    if (typeof data.state !== 'string') return;
    infantState = data.state;
    saveStoredState(roomId, 'parent', { infantState, updatedAt: Date.now() });
    updateStateSummaryDisplay();
    ensureStateSummaryInterval();
}

function handleParentDataMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'elevated' || data.type === 'cry') handleElevatedAudioMessage({ ...data, type: 'elevated' });
    if (data.type === 'state') handleStateMessage(data);
    if (data.type === 'dim' && typeof data.enabled === 'boolean') {
        setParentDimStateFromChild(data.enabled);
    }
    if (data.type === 'white_noise') handleWhiteNoiseMessage(data);
}

function handleChildDataMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'dim' && typeof data.enabled === 'boolean') {
        setDimOverlay(!!data.enabled);
        sendDimState();
    }
    if (data.type === 'white_noise') handleWhiteNoiseMessage(data);
}

function sendElevatedEvent(ts) {
    broadcastToParents({ type: 'elevated', ts });
}

function sendStateEvent(state, confidence) {
    broadcastToParents({ type: 'state', state, confidence, ts: Date.now() });
}

function connectDataChannelToChild() {
    const targetId = `babymonitor-${roomId}-child`;
    if (dataConn && dataConn.open) return;
    if (dataConn) dataConn.close();
    dataConn = peer.connect(targetId, { reliable: true });
    dataConn.on('open', () => {
        log('Data channel open', false);
        resetParentRetry();
        if (whiteNoiseEnabled) {
            sendWhiteNoisePayload({
                type: 'white_noise',
                action: 'start',
                volume: whiteNoiseVolume,
                durationMs: whiteNoiseDurationMs,
                startedAt: whiteNoiseStartedAt
            });
        } else {
            sendWhiteNoisePayload({ type: 'white_noise', action: 'stop' });
        }
    });
    dataConn.on('data', handleParentDataMessage);
    dataConn.on('error', (err) => {
        log(`Data channel error: ${err.type || err}`, true);
        retryParentConnection();
    });
    dataConn.on('close', () => {
        log('Data channel closed', true);
        retryParentConnection();
    });
}

function handleIncomingParentConnection(conn) {
    if (parentDataConns.has(conn.peer)) {
        try { parentDataConns.get(conn.peer).close(); } catch (e) {}
    }
    parentDataConns.set(conn.peer, conn);
    conn.on('data', handleChildDataMessage);
    conn.on('open', () => {
        log('Parent data channel open', false);
        sendDimState();
        if (whiteNoiseEnabled && conn.open) {
            conn.send({
                type: 'white_noise',
                action: 'start',
                volume: whiteNoiseVolume,
                durationMs: whiteNoiseDurationMs,
                startedAt: whiteNoiseStartedAt
            });
        }
    });
    conn.on('error', (err) => log(`Parent data channel error: ${err.type || err}`, true));
    conn.on('close', () => {
        parentDataConns.delete(conn.peer);
        log('Parent data channel closed', true);
    });
}

function updateChildConnectionState() {
    if (role !== 'child') return;
    setStatusText(childCalls.size > 0 ? 'connected' : 'waiting');
}

function answerPendingChildCalls() {
    if (pendingChildCalls.length === 0) return;
    const streamToSend = sendStream || localStream;
    if (!streamToSend) return;
    const queued = pendingChildCalls.slice();
    pendingChildCalls = [];
    queued.forEach(call => acceptChildCall(call, streamToSend));
}

function acceptChildCall(call, streamToSend) {
    if (!call) return;
    call.answer(streamToSend);
    childCalls.set(call.peer, call);
    updateChildConnectionState();
    attachCallConnectionListeners(call, 'child');
    startStatsLoop(call, 'outbound');

    call.on('close', () => {
        childCalls.delete(call.peer);
        updateChildConnectionState();
        if (statsInterval) clearInterval(statsInterval);
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        childCalls.delete(call.peer);
        updateChildConnectionState();
        if (statsInterval) clearInterval(statsInterval);
    });
}

function handleChildCall(call) {
    if (!call) return;
    log(`Incoming Call from ${call.peer}`, false);
    const streamToSend = sendStream || localStream;
    if (!streamToSend) {
        log('Mic not ready yet. Queuing call...', false);
        pendingChildCalls.push(call);
        call.on('close', () => {
            pendingChildCalls = pendingChildCalls.filter(item => item !== call);
        });
        call.on('error', () => {
            pendingChildCalls = pendingChildCalls.filter(item => item !== call);
        });
        return;
    }
    acceptChildCall(call, streamToSend);
}

// --- CHILD LOGIC ---
function initChild() {
    const myId = `babymonitor-${roomId}-child`;
    log(`Creating Peer: ${myId}...`);
    
    if (peer) peer.destroy();
    peer = new Peer(myId, PEER_CONFIG);

    peer.on('open', (id) => {
        log('Peer Open. ID: ' + id, false);
        if (peerReconnectTimer) {
            clearTimeout(peerReconnectTimer);
            peerReconnectTimer = null;
        }
        switchToMonitor();
        updateStatus(true); // Connected to signaling server
        setStatusText('waiting');
        startStreaming();
    });

    peer.on('call', (call) => handleChildCall(call));
    peer.on('connection', (conn) => handleIncomingParentConnection(conn));

    peer.on('error', (err) => {
        console.error('Peer Error:', err.type, err);
        if (err.type === 'unavailable-id') {
            log(`ID '${roomId}' taken.`, true);
            alert('Room Name Taken. Please choose another.');
            stopSession();
        } else if (err.type === 'network') {
            log('Network Error.', true);
        } else {
            log(`Peer Error: ${err.type}`, true);
            updateStatus(false);
            setStatusText('disconnected');
            // General error, retry initialization
            setTimeout(initChild, 5000);
        }
    });

    peer.on('disconnected', () => {
        log('Disconnected from Server. Reconnecting...', true);
        updateStatus(false);
        setStatusText('disconnected');
        if (peerReconnectTimer) return;
        peerReconnectTimer = setTimeout(() => {
            peerReconnectTimer = null;
            try {
                peer.destroy();
            } catch (e) {
                console.warn('Peer destroy failed during reconnect:', e);
            }
            initChild();
        }, 2000);
    });
}

async function startStreaming() {
    try {
        if (!localStream) {
            log("Requesting Mic...", false);
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            log(`Mic Active. Tracks: ${localStream.getTracks().length}`, false);
        }
        
        setupVAD(localStream);
        setupTransmitChain(localStream);
        answerPendingChildCalls();
        
    } catch (err) {
        console.error('Failed to get media', err);
        log(`Mic Error: ${err.message}`, true);
        alert('Microphone access denied: ' + err.message);
    }
}

function setupVAD(stream) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Clone the track for VAD so we can still analyze even when transmission is disabled
    if (vadTrack) vadTrack.stop();
    vadTrack = stream.getAudioTracks()[0].clone();
    const vadStream = new MediaStream([vadTrack]);
    const source = audioCtx.createMediaStreamSource(vadStream);
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Start loop
    if (vadInterval) clearInterval(vadInterval);
    
    visualize('child');

    let logCounter = 0;
    lastVadSampleTs = Date.now();
    vadInterval = setInterval(() => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate RMS (volume)
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const levelDb = rmsToDb(rms);
        const now = Date.now();
        const dt = lastVadSampleTs ? (now - lastVadSampleTs) : 100;
        lastVadSampleTs = now;

        updateNoiseFloor(levelDb, dt);
        maybeDetectElevatedActivity(levelDb, now);
        updateInfantState(levelDb, now);
        
        const vadThresholdDb = noiseFloorDb !== null ? noiseFloorDb + VAD_MIN_DB_ABOVE_NOISE : null;
        if (vadThresholdDb !== null && levelDb >= vadThresholdDb) {
            lastNoiseTime = now;
        }
        if (logCounter % 50 === 0) {
            console.log(`VAD: dB=${levelDb.toFixed(1)}, Threshold=${vadThresholdDb !== null ? vadThresholdDb.toFixed(1) : 'n/a'}, Active=${isTransmitting}`);
        }
        logCounter++;

        if (!isTransmitting) {
            ensureTransmission(true);
        }

    }, 250);
}

function setupTransmitChain(stream) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (micGainNode) {
        try { micGainNode.disconnect(); } catch (e) {}
    }

    const source = audioCtx.createMediaStreamSource(stream);
    micGainNode = audioCtx.createGain();
    micGainNode.gain.value = MIC_BOOST_GAIN;

    const destination = audioCtx.createMediaStreamDestination();
    source.connect(micGainNode);
    if (!transmitMixNode) {
        transmitMixNode = audioCtx.createGain();
        transmitMixNode.gain.value = 1.0;
    } else {
        try { transmitMixNode.disconnect(); } catch (e) {}
    }
    micGainNode.connect(transmitMixNode);
    if (whiteNoiseCancelGain) {
        try { whiteNoiseCancelGain.disconnect(); } catch (e) {}
        whiteNoiseCancelGain.connect(transmitMixNode);
    }
    transmitMixNode.connect(destination);

    sendStream = destination.stream;
    sendTrack = sendStream.getAudioTracks()[0];
    ensureTransmission(true);
}

function ensureTransmission(enabled) {
    if (!sendTrack) return;
    sendTrack.enabled = enabled;
    isTransmitting = enabled;
}

function rmsToDb(rms) {
    const safe = Math.max(1, rms);
    return 20 * Math.log10(safe / 255);
}

function updateNoiseFloor(levelDb, dtMs) {
    if (!Number.isFinite(levelDb)) return;
    if (noiseFloorDb === null) {
        noiseFloorDb = levelDb;
        return;
    }
    const windowMs = Math.max(1000, CRY_CONFIG.noiseFloorWindowSeconds * 1000);
    const alpha = 1 - Math.exp(-dtMs / windowMs);
    if (levelDb < noiseFloorDb + CRY_CONFIG.noiseFloorUpdateMarginDb) {
        noiseFloorDb = noiseFloorDb + alpha * (levelDb - noiseFloorDb);
    }
}

function maybeDetectElevatedActivity(levelDb, now) {
    if (!Number.isFinite(levelDb) || noiseFloorDb === null) return;
    if (now < elevatedCooldownUntil) {
        elevatedStartTsForAlert = null;
        return;
    }
    const thresholdDb = noiseFloorDb + CRY_CONFIG.minDbAboveNoise;
    if (levelDb >= thresholdDb) {
        if (!elevatedStartTsForAlert) elevatedStartTsForAlert = now;
        const sustainMs = CRY_CONFIG.sustainedSeconds * 1000;
        if (now - elevatedStartTsForAlert >= sustainMs) {
            sendElevatedEvent(now);
            log('Elevated audio detected', false);
            elevatedCooldownUntil = now + (CRY_CONFIG.cooldownSeconds * 1000);
            elevatedStartTsForAlert = null;
        }
    } else {
        elevatedStartTsForAlert = null;
    }
}



function setChildState(nextState, confidence = null) {
    if (role !== 'child') return;
    if (currentInfantState === nextState) return;
    currentInfantState = nextState;
    sendStateEvent(nextState, confidence);
}

function updateInfantState(levelDb, now) {
    if (!Number.isFinite(levelDb) || noiseFloorDb === null) return;
    const above = levelDb - noiseFloorDb;

    if (above >= STATE_THRESHOLDS.needsCareDbAboveNoise) {
        if (!elevatedStartTs) elevatedStartTs = now;
        const elapsed = now - elevatedStartTs;
        if (elapsed >= STATE_THRESHOLDS.needsCareSustainedSeconds * 1000) {
            setChildState('needsCare', 0.9);
        } else if (elapsed >= STATE_THRESHOLDS.stirringSeconds * 1000) {
            setChildState('stirring', 0.7);
        }
        return;
    }

    elevatedStartTs = null;

    if (above >= STATE_THRESHOLDS.stirringDbAboveNoise) {
        setChildState('stirring', 0.6);
        return;
    }

    const sinceLastNoise = now - lastNoiseTime;
    if (sinceLastNoise >= STATE_THRESHOLDS.settleSeconds * 1000) {
        setChildState('zzz', 0.8);
    } else {
        setChildState('settled', 0.65);
    }
}
function getSilentStream() {
    if (silentStream) return silentStream;
    if (!silentAudioCtx) {
        silentAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (silentAudioCtx.state === 'suspended') {
        silentAudioCtx.resume();
    }
    const destination = silentAudioCtx.createMediaStreamDestination();
    silentStream = destination.stream;
    return silentStream;
}

function connectToChild() {
    if (!peer) return;
    if (currentCall) {
        currentCall.close();
    }

    const targetId = `babymonitor-${roomId}-child`;
    log(`Calling Child (${targetId})...`, false);

    const call = peer.call(targetId, getSilentStream());
    handleParentCall(call);
}

function retryParentConnection() {
    if (parentRetryTimeout) return; // Already retrying
    const delay = parentRetryDelay;
    log(`Reconnecting in ${Math.round(delay / 1000)}s...`, false);
    parentRetryTimeout = setTimeout(() => {
        parentRetryTimeout = null;
        connectToChild();
        connectDataChannelToChild();
        parentRetryDelay = Math.min(parentRetryDelay * 2, 30000);
    }, delay);
}

function resetParentRetry() {
    if (parentRetryTimeout) clearTimeout(parentRetryTimeout);
    parentRetryTimeout = null;
    parentRetryDelay = 3000;
}

// --- PARENT LOGIC ---
function initParent() {
    const parentSuffix = Math.random().toString(36).slice(2, 8);
    const myId = `babymonitor-${roomId}-parent-${parentSuffix}`;
    log(`Creating Peer: ${myId}...`);
    
    if (peer) peer.destroy();
    peer = new Peer(myId, PEER_CONFIG);

    peer.on('open', (id) => {
        log('Peer Open. Connecting to Child...', false);
        switchToMonitor();
        updateStatus(true); 
        audioStatus.textContent = "Connecting to Child unit...";
        setStatusText('waiting');
        btnListen.style.display = 'none';
        resetParentRetry();
        connectToChild();
        connectDataChannelToChild();
    });
    
    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
             log(`ID '${roomId}' taken.`, true);
             alert('Room Name Taken.');
             stopSession();
        } else {
            log(`Peer Error: ${err.type}`, true);
            updateStatus(false);
            retryParentConnection();
        }
    });
    
    peer.on('disconnected', () => {
         log('Disconnected. Reconnecting...', true);
         peer.reconnect();
    });
}

function handleParentCall(call) {
    if (currentCall) {
        currentCall.close();
    }
    currentCall = call;
    attachCallConnectionListeners(call, 'parent');
    startStatsLoop(call, 'inbound');
    
    call.on('stream', (remoteStream) => {
        console.log('Stream received');
        pendingRemoteStream = remoteStream;
        updateStatus(true, 'active');
        statusIndicator.style.backgroundColor = '#69f0ae';
        setStatusText('connected');
        resetParentRetry();
        if (audioUnlocked) {
            startPlayback(remoteStream);
        } else {
            audioStatus.textContent = "Tap 'Start Listening' to hear audio";
            btnListen.style.display = 'block';
        }
    });

    call.on('close', () => {
        console.log('Call closed');
        updateStatus(true); // Still connected to server, just lost call
        audioStatus.textContent = "Signal Lost. Waiting for Child...";
        stopVisualizer();
        statusIndicator.style.backgroundColor = '#ffcc00'; // Yellow/Orange for waiting
        setStatusText('waiting');
        pendingRemoteStream = null;
        if (statsInterval) clearInterval(statsInterval);
        retryParentConnection();
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        if (statsInterval) clearInterval(statsInterval);
        retryParentConnection();
    });
}

// Audio Handling
function startPlayback(stream) {
    const remoteAudio = document.getElementById('remote-audio');
    if (!remoteAudio) return;

    pendingRemoteStream = stream;
    remoteAudio.srcObject = stream;
    remoteAudio.muted = false;

    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    teardownAudioGraph();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(6.0, audioCtx.currentTime);
    source.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    visualize('parent');

    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    remoteAudio.play().then(() => {
        btnListen.style.display = 'none';
        audioStatus.textContent = "Audio Connected";
    }).catch(err => {
        console.warn('Audio play blocked:', err);
        audioStatus.textContent = "Tap 'Start Listening' to hear audio";
        btnListen.style.display = 'block';
    });
}

function resumeAudioContext() {
    audioUnlocked = true;
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
        remoteAudio.muted = false;
        remoteAudio.play().catch(e => console.error('Audio play failed:', e));
    }

    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            btnListen.style.display = 'none';
            audioStatus.textContent = "Audio Connected";
        });
    } else {
        btnListen.style.display = 'none';
        audioStatus.textContent = "Audio Connected";
    }

    if (pendingRemoteStream) {
        startPlayback(pendingRemoteStream);
    }
}

// Visualizer
function visualize(prefix) {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const dbMeterFill = document.getElementById(`${prefix}-db-level`);

    lastVisualizerPrefix = prefix;
    visualizerActive = true;
    function draw() {
        if (!analyser || !visualizerActive) return;
        visualizerRafId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        const levelPercent = Math.min(100, (average / 150) * 100);
        if (dbMeterFill) {
            dbMeterFill.style.width = `${levelPercent}%`;
            
            if (levelPercent > 85) dbMeterFill.style.backgroundColor = '#ff5252';
            else if (levelPercent > 60) dbMeterFill.style.backgroundColor = '#ffcc00';
            else dbMeterFill.style.backgroundColor = '#69f0ae';
        }
    }
    draw();
}

function stopVisualizer() {
    visualizerActive = false;
    if (visualizerRafId) cancelAnimationFrame(visualizerRafId);
    visualizerRafId = null;
    const allMeters = document.querySelectorAll('.meter-fill');
    allMeters.forEach(meter => {
        meter.style.width = '0%';
    });
}

function updateStatus(isConnected, type = 'server') {
    if (isConnected) {
        statusIndicator.classList.remove('disconnected');
        statusIndicator.classList.add('connected');
    } else {
        statusIndicator.classList.add('disconnected');
        statusIndicator.classList.remove('connected');
    }
}

function setStatusText(state) {
    connectionState = state;
    if (!statusText) return;
    const room = roomId || '--';
    const label = state === 'connected' ? 'Audio connected' : (state === 'waiting' ? 'Waiting' : 'Disconnected');
    statusText.textContent = `${label} · Room: ${room}`;

    if (statusIndicator) {
        statusIndicator.classList.remove('connected', 'disconnected', 'waiting');
        statusIndicator.classList.add(state === 'connected' ? 'connected' : (state === 'waiting' ? 'waiting' : 'disconnected'));
    }
}

function teardownAudioGraph() {
    if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
    }
    if (gainNode) {
        try { gainNode.disconnect(); } catch (e) {}
    }
    analyser = null;
    gainNode = null;
}

function ensureDebugPanel() {
    const urlParams = new URLSearchParams(window.location.search);
    const debugEnabled = urlParams.get('debug') === '1';
    if (!debugEnabled || !monitorScreen || debugPanel) return;

    debugPanel = document.createElement('div');
    debugPanel.id = 'debug-panel';
    debugPanel.textContent = 'Debug: Initializing...';
    monitorScreen.appendChild(debugPanel);
}

function updateDebugPanel(lines) {
    if (!debugPanel) return;
    debugPanel.textContent = lines.join(' | ');
}

function configureTurnIfPresent() {
    if (!window.TURN_CONFIG) return;
    const turn = window.TURN_CONFIG;
    if (!turn.urls) return;
    PEER_CONFIG.config.iceServers = [
        ...ICE_SERVERS,
        { urls: turn.urls, username: turn.username, credential: turn.credential }
    ];
}

function attachCallConnectionListeners(call, roleLabel) {
    if (!call || !call.peerConnection) return;
    const pc = call.peerConnection;
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        log(`ICE state: ${state}`, state === 'failed');
        if (roleLabel !== 'child') {
            if (state === 'connected' || state === 'completed') {
                setStatusText('connected');
            } else if (state === 'disconnected') {
                setStatusText('waiting');
            } else if (state === 'failed') {
                setStatusText('disconnected');
            }
        }
        if (state === 'failed' || state === 'disconnected') {
            if (roleLabel === 'parent' && audioStatus) {
                audioStatus.textContent = "Connection unstable. Reconnecting...";
                retryParentConnection();
            }
        }
    };
    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        log(`Connection state: ${state}`, state === 'failed');
        if (roleLabel !== 'child') {
            if (state === 'connected') {
                setStatusText('connected');
            } else if (state === 'disconnected') {
                setStatusText('waiting');
            } else if (state === 'failed') {
                setStatusText('disconnected');
            }
        }
        if (state === 'failed') {
            if (roleLabel === 'parent' && audioStatus) {
                audioStatus.textContent = "Connection failed. Reconnecting...";
                retryParentConnection();
            }
        }
    };
}

function startStatsLoop(call, direction) {
    if (!call || !call.peerConnection) return;
    if (statsInterval) clearInterval(statsInterval);
    if (statsLoopRunning) statsLoopRunning = false;
    lastStats = null;
    lastAudioEnergy = null;
    lastAudioEnergyTs = null;
    let badCount = 0;
    let goodCount = 0;
    let bitrateIndex = BITRATE_DEFAULT_INDEX;

    statsInterval = setInterval(async () => {
        if (statsLoopRunning) return;
        statsLoopRunning = true;
        try {
            if (!call.peerConnection) return;
            const stats = await call.peerConnection.getStats(null);
            let outbound = null;
            let inbound = null;
            let candidatePair = null;

            stats.forEach(report => {
                if (report.type === 'outbound-rtp' && report.kind === 'audio') outbound = report;
                if (report.type === 'inbound-rtp' && report.kind === 'audio') inbound = report;
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.selected) candidatePair = report;
            });

            const now = Date.now();
            let bitrate = null;
            let rtt = candidatePair ? candidatePair.currentRoundTripTime : null;
            let jitter = inbound ? inbound.jitter : null;
            let packetsLost = inbound ? inbound.packetsLost : null;
            let packetsReceived = inbound ? inbound.packetsReceived : null;
            let bytes = direction === 'outbound' ? outbound?.bytesSent : inbound?.bytesReceived;

            if (lastStats && bytes != null) {
                const timeDelta = (now - lastStats.timeMs) / 1000;
                const bytesDelta = bytes - lastStats.bytes;
                if (timeDelta > 0 && bytesDelta >= 0) {
                    bitrate = Math.round((bytesDelta * 8) / timeDelta);
                }
            }

            if (bytes != null) lastStats = { timeMs: now, bytes };

            const lossRatio = packetsReceived ? packetsLost / Math.max(1, packetsReceived + packetsLost) : 0;
            const isBad = (lossRatio > 0.05) || (rtt != null && rtt > 0.35);
            if (isBad) {
                badCount += 1;
                goodCount = 0;
            } else {
                goodCount += 1;
                badCount = 0;
            }

            if (direction === 'outbound') {
                if (badCount >= BITRATE_STEP_DOWN_AFTER && bitrateIndex > 0) {
                    bitrateIndex -= 1;
                    applyMaxBitrate(call.peerConnection, BITRATE_LEVELS[bitrateIndex]);
                    badCount = 0;
                }
                if (goodCount >= BITRATE_STEP_UP_AFTER && bitrateIndex < BITRATE_LEVELS.length - 1) {
                    bitrateIndex += 1;
                    applyMaxBitrate(call.peerConnection, BITRATE_LEVELS[bitrateIndex]);
                    goodCount = 0;
                }
            }

            latestNetworkLabel = isBad ? 'Network: Poor' : 'Network: Good';

            if (inbound) {
                const totalEnergy = inbound.totalAudioEnergy;
                const totalSamples = inbound.totalSamplesReceived;
                const remoteAudio = document.getElementById('remote-audio');
                if (totalEnergy != null && totalSamples != null) {
                    if (lastAudioEnergy != null) {
                        const energyDelta = totalEnergy - lastAudioEnergy;
                        if (energyDelta < 0.0001 && (now - lastAudioEnergyTs) > SILENCE_WARN_MS) {
                            const needsUnlock = (audioCtx && audioCtx.state === 'suspended') || (remoteAudio && remoteAudio.paused) || (remoteAudio && remoteAudio.muted);
                            if (needsUnlock) {
                                audioStatus.textContent = "Tap 'Start Listening' to resume audio";
                                btnListen.style.display = 'block';
                            }
                        } else {
                            lastAudioEnergyTs = now;
                        }
                    } else {
                        lastAudioEnergyTs = now;
                    }
                    lastAudioEnergy = totalEnergy;
                }
            }

            updateDebugPanel([
                latestNetworkLabel,
                bitrate ? `Bitrate: ${(bitrate / 1000).toFixed(1)}kbps` : 'Bitrate: n/a',
                rtt != null ? `RTT: ${(rtt * 1000).toFixed(0)}ms` : 'RTT: n/a',
                jitter != null ? `Jitter: ${(jitter * 1000).toFixed(0)}ms` : 'Jitter: n/a',
                packetsLost != null ? `Loss: ${packetsLost}` : 'Loss: n/a'
            ]);
        } finally {
            statsLoopRunning = false;
        }
    }, STATS_INTERVAL_MS);
}

function applyMaxBitrate(peerConnection, maxBitrate) {
    try {
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (!sender) return;
        const parameters = sender.getParameters();
        if (!parameters.encodings) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = maxBitrate;
        sender.setParameters(parameters);
        log(`Set max bitrate to ${Math.round(maxBitrate / 1000)}kbps`, false);
    } catch (e) {
        console.warn('Failed to set max bitrate', e);
    }
}

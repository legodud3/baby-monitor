import * as config from './modules/config.js';
import * as utils from './modules/utils.js';
import * as ui from './modules/ui.js';
import * as audio from './modules/audio.js';
import * as network from './modules/network.js';
import * as alarm from './modules/alarm.js';

const { elements } = ui;

// Application State
let role = null;
let roomId = null;
let displayBabyName = '';
let displayJoinCode = '';
let selectedRole = null;
let isDimmed = false;

let infantState = 'zzz';
let lastElevatedTs = null;
let stateSummaryInterval = null;

let whiteNoiseEnabled = false;
let whiteNoiseVolume = 0.5;
let whiteNoiseDurationMs = null;
let whiteNoiseStartedAt = null;

let parentRetryDelay = 3000;
let parentRetryTimeout = null;

let wakeLock = null;
let heartbeatInterval = null;
let lastHeartbeatAt = 0;

// Initialization
function init() {
    restoreLastSession();
    attachEventListeners();
    updateConnectState();
}

function restoreLastSession() {
    try {
        const savedName = localStorage.getItem(config.LAST_BABY_NAME_KEY);
        if (savedName && !elements.babyNameInput.value.trim()) {
            elements.babyNameInput.value = savedName;
        }
        const savedCode = localStorage.getItem(config.LAST_JOIN_CODE_KEY);
        if (savedCode && !elements.roomIdInput.value.trim()) {
            elements.roomIdInput.value = utils.normalizeJoinCode(savedCode);
        }
    } catch (e) {}
}

function attachEventListeners() {
    elements.btnChild.addEventListener('click', () => selectRole('child'));
    elements.btnParent.addEventListener('click', () => selectRole('parent'));
    elements.btnConnect.addEventListener('click', () => {
        if (!selectedRole) {
            alert('Please select a device role.');
            return;
        }
        startSession(selectedRole);
    });
    elements.btnStop.addEventListener('click', stopSession);
    elements.btnListen.addEventListener('click', resumeAudio);
    elements.btnDimParent?.addEventListener('click', toggleParentDim);
    elements.roomIdInput.addEventListener('input', updateConnectState);
    elements.btnCopyCode.addEventListener('click', copyJoinCode);
    elements.btnNewCode.addEventListener('click', regenerateJoinCode);
    
    elements.dimOverlay.addEventListener('click', (e) => {
        if (role !== 'child') return;
        handleChildWakeTap(e);
    });
}

let lastDimTap = 0;
function handleChildWakeTap(e) {
    const now = Date.now();
    const tapLength = now - lastDimTap;
    if (tapLength < 500 && tapLength > 0) {
        setDimOverlay(false);
        sendDimStateFromChild(false);
        e.preventDefault();
    }
    lastDimTap = now;
}

function selectRole(nextRole) {
    selectedRole = nextRole;
    elements.btnChild.classList.toggle('selected', nextRole === 'child');
    elements.btnParent.classList.toggle('selected', nextRole === 'parent');
    elements.btnConnect.textContent = nextRole === 'child' ? 'Connect as Child' : 'Connect as Parent';
    
    if (nextRole === 'child' && !elements.roomIdInput.value.trim()) {
        elements.roomIdInput.value = utils.generateJoinCode();
    }
    
    elements.joinCodeActions.classList.toggle('hidden', nextRole !== 'child');
    updateConnectState();
}

function updateConnectState() {
    const joinCode = utils.normalizeJoinCode(elements.roomIdInput.value);
    elements.btnConnect.disabled = !(utils.isValidJoinCode(joinCode) && selectedRole);
}

function copyJoinCode() {
    const joinCode = utils.normalizeJoinCode(elements.roomIdInput.value);
    navigator.clipboard.writeText(joinCode).then(() => {
        utils.log(`Join code copied: ${joinCode}`);
    });
}

function regenerateJoinCode() {
    elements.roomIdInput.value = utils.generateJoinCode();
    updateConnectState();
}

async function startSession(roleChoice) {
    role = roleChoice;
    const joinCode = utils.normalizeJoinCode(elements.roomIdInput.value);
    if (!utils.isValidJoinCode(joinCode)) {
        alert('Invalid Join Code.');
        return;
    }

    displayJoinCode = joinCode;
    displayBabyName = elements.babyNameInput.value.trim();
    roomId = deriveSessionId(joinCode);
    
    try {
        localStorage.setItem(config.LAST_JOIN_CODE_KEY, displayJoinCode);
        if (displayBabyName) localStorage.setItem(config.LAST_BABY_NAME_KEY, displayBabyName);
    } catch (e) {}

    utils.log(`Starting session as ${role}...`);
    
    // UI Setup
    ui.showScreen('monitor');
    elements.roleDisplay.textContent = role === 'child' ? 'Child Unit' : 'Parent Unit';
    elements.monitorScreen.classList.toggle('parent-layout', role === 'parent');
    elements.monitorScreen.classList.toggle('child-layout', role === 'child');
    
    if (role === 'child') {
        elements.childControls.classList.remove('hidden');
        elements.parentControls.classList.add('hidden');
        initChildFlow();
    } else {
        elements.parentControls.classList.remove('hidden');
        elements.childControls.classList.add('hidden');
        initParentFlow();
    }

    requestWakeLock();
    startWakeLockVideo();
    setStatusText('disconnected');
}

function deriveSessionId(joinCode) {
    const hash = utils.hashString32(joinCode);
    return `code-${hash.toString(36)}`;
}

function setStatusText(state) {
    const baby = displayBabyName || displayJoinCode || '--';
    const idLabel = displayBabyName ? 'Baby' : 'Code';
    let label = state === 'connected' ? 'Audio connected' : (state === 'waiting' ? 'Waiting' : 'Disconnected');
    
    if (state === 'alarm') {
        elements.statusText.textContent = 'ALARM · Check baby connection';
    } else if (role === 'parent' && state === 'connected') {
        elements.statusText.textContent = `Audio connected · Spying on ${baby}`;
    } else {
        elements.statusText.textContent = `${label} · ${idLabel}: ${baby}`;
    }
    
    ui.updateConnectionStatus(state);
}

// Child Flow
async function initChildFlow() {
    const myId = `babymonitor-${roomId}-child`;
    network.initNetwork({
        onOpen: (id) => {
            utils.log(`Network open. ID: ${id}`);
            setStatusText('waiting');
            startChildStreaming();
            startHeartbeat();
        },
        onCall: handleIncomingCall,
        onConnection: handleIncomingDataConnection,
        onError: (err) => {
            utils.log(`Network error: ${err.type}`, true);
            setStatusText('disconnected');
            setTimeout(() => location.reload(), 5000);
        },
        onDisconnected: () => setStatusText('disconnected')
    });
    network.createPeer(myId);
    
    audio.initAudio({
        onElevatedActivity: (ts) => network.broadcastToParents({ type: 'elevated', ts }),
        onStateChange: (state, confidence) => {
            network.broadcastToParents({ type: 'state', state, confidence, ts: Date.now() });
        }
    });
}

async function startChildStreaming() {
    try {
        const stream = await audio.getLocalStream();
        audio.setupVAD(stream, (prefix, analyser) => ui.visualize(prefix, analyser));
        const sendStream = audio.setupTransmitChain(stream);
        
        // Answer pending calls
        const pending = network.getPendingChildCalls();
        pending.forEach(call => call.answer(sendStream));
        network.setPendingChildCalls([]);
    } catch (err) {
        utils.log(`Mic Error: ${err.message}`, true);
        alert('Microphone access denied: ' + err.message);
    }
}

function handleIncomingCall(call) {
    const stream = audio.setupTransmitChain();
    if (!stream) {
        network.getPendingChildCalls().push(call);
        return;
    }
    call.answer(stream);
    network.getChildCalls().set(call.peer, call);
    setStatusText('connected');
    
    network.startStatsLoop(call, 'outbound', (stats) => {
        // Handle child stats
    });
    
    call.on('close', () => {
        network.getChildCalls().delete(call.peer);
        if (network.getChildCalls().size === 0) setStatusText('waiting');
    });
}

function handleIncomingDataConnection(conn) {
    network.getParentDataConns().set(conn.peer, conn);
    conn.on('data', (data) => handleChildDataMessage(data));
    conn.on('open', () => {
        utils.log('Parent data channel open');
    });
}

function handleChildDataMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'dim') setDimOverlay(!!data.enabled);
}

// Parent Flow
function initParentFlow() {
    const parentSuffix = Math.random().toString(36).slice(2, 8);
    const myId = `babymonitor-${roomId}-parent-${parentSuffix}`;
    
    network.initNetwork({
        onOpen: (id) => {
            utils.log(`Network open. ID: ${id}`);
            setStatusText('waiting');
            resetParentRetry();
            connectToChild();
        },
        onError: (err) => {
            utils.log(`Network error: ${err.type}`, true);
            setStatusText('disconnected');
            retryParentConnection();
        },
        onDisconnected: () => setStatusText('disconnected')
    });
    network.createPeer(myId);
    
    alarm.initAlarm();
    startHeartbeatWatchdog();
}

function connectToChild() {
    const call = network.connectToChild(roomId, audio.createMediaStreamDestination().stream);
    if (!call) return;
    
    handleParentCall(call);
    
    const dataConn = network.connectDataChannelToChild(roomId);
    dataConn.on('data', (data) => handleParentDataMessage(data));
    dataConn.on('open', () => {
        utils.log('Data channel open');
        alarm.clearAlarmGrace();
    });
}

function handleParentCall(call) {
    call.on('stream', (stream) => {
        utils.log('Audio stream received');
        setStatusText('connected');
        audio.startPlayback(stream, (prefix, analyser) => ui.visualize(prefix, analyser));
    });
    
    call.on('close', () => {
        setStatusText('waiting');
        retryParentConnection();
    });
    
    network.startStatsLoop(call, 'inbound', (stats) => {
        if (stats.silenceDetected) {
            elements.audioStatus.textContent = "Silence detected. Check child unit.";
        }
    });
}

function handleParentDataMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'heartbeat') {
        lastHeartbeatAt = Date.now();
        alarm.clearAlarmGrace();
    }
    if (data.type === 'elevated') handleElevatedEvent(data.ts);
    if (data.type === 'state') handleStateEvent(data.state);
}

function handleElevatedEvent(ts) {
    lastElevatedTs = ts;
    infantState = 'needsCare';
    updateStateSummary();
}

function handleStateEvent(state) {
    infantState = state;
    updateStateSummary();
}

function updateStateSummary() {
    const labels = {
        zzz: '😴 Zzz',
        settled: '🙂 Settled',
        stirring: '😣 Stirring',
        needsCare: '🚨 Needs attention'
    };
    const label = labels[infantState] || infantState;
    elements.stateSummaryEl.textContent = `Baby state: ${label}`;
}

function retryParentConnection() {
    if (parentRetryTimeout) return;
    utils.log(`Retrying connection in ${parentRetryDelay/1000}s...`);
    parentRetryTimeout = setTimeout(() => {
        parentRetryTimeout = null;
        connectToChild();
        parentRetryDelay = Math.min(parentRetryDelay * 2, 30000);
    }, parentRetryDelay);
}

function resetParentRetry() {
    if (parentRetryTimeout) clearTimeout(parentRetryTimeout);
    parentRetryTimeout = null;
    parentRetryDelay = 3000;
}

// Heartbeat
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        network.broadcastToParents({ type: 'heartbeat', ts: Date.now() });
    }, config.HEARTBEAT_INTERVAL_MS);
}

function startHeartbeatWatchdog() {
    lastHeartbeatAt = Date.now();
    setInterval(() => {
        const now = Date.now();
        if (now - lastHeartbeatAt > config.HEARTBEAT_TIMEOUT_MS) {
            alarm.scheduleAlarm('Connection lost (Heartbeat timeout)');
            setStatusText('disconnected');
        }
    }, config.HEARTBEAT_INTERVAL_MS);
}

// UI Actions
function resumeAudio() {
    audio.getAudioContext().resume().then(() => {
        elements.btnListen.style.display = 'none';
    });
}

function toggleParentDim() {
    isDimmed = !isDimmed;
    ui.toggleDim(isDimmed);
    network.sendToChild({ type: 'dim', enabled: isDimmed });
}

function setDimOverlay(enabled) {
    isDimmed = enabled;
    ui.toggleDim(enabled);
}

function sendDimStateFromChild(enabled) {
    network.broadcastToParents({ type: 'dim', enabled, source: 'child' });
}

function stopSession() {
    location.reload();
}

// Wake Lock
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {}
    }
}

function startWakeLockVideo() {
    elements.wakeLockVideo.play().catch(() => {});
}

// Boot
init();

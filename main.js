import * as config from './modules/config.js';
import * as utils from './modules/utils.js';
import * as ui from './modules/ui.js';
import * as audio from './modules/audio.js';
import * as network from './modules/network.js';
import * as alarm from './modules/alarm.js';
import { shouldTriggerParentAlarm } from './modules/watchdog.js';

const { elements } = ui;

// Application State
let role = null;
let roomId = null;
let displayBabyName = '';
let displayJoinCode = '';
let selectedRole = null;
let currentStatusStage = null;
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
let parentConnectAttempt = 0;
let parentConsecutiveFailures = 0;
let parentPeerResetCount = 0;
let parentStatsLastLogAt = 0;
let parentHeartbeatCount = 0;
let parentHeartbeatWarningShown = false;
let parentHeartbeatAlarmActive = false;
let parentMediaConnected = false;
let parentLastMediaActivityAt = 0;
let parentDataChannelOpen = false;
let parentDataChannelOpenTimeout = null;
let parentDataChannelRetryCount = 0;
let parentDataMissingLogShown = false;
let childHeartbeatCount = 0;
let childStatsLastLogAt = 0;

let wakeLock = null;
let heartbeatInterval = null;
let lastHeartbeatAt = 0;
let parentConnectionState = 'idle';
let parentPeerId = null;

const PARENT_CONNECTION_STATES = Object.freeze({
    IDLE: 'idle',
    SIGNALING: 'signaling',
    NEGOTIATING: 'negotiating',
    MEDIA_UP: 'media_up',
    DEGRADED: 'degraded',
    RETRYING: 'retrying',
    FAILED: 'failed'
});

const PARENT_MAX_CONSECUTIVE_FAILURES_BEFORE_PEER_RESET = 4;

const STATUS_STAGE_LABELS = Object.freeze({
    parent: Object.freeze({
        appStart: 'Starting up...',
        serverLink: 'Connecting to server...',
        discovery: 'Finding baby unit...',
        handshake: 'Establishing link...',
        active: 'Listening',
        interrupted: 'Searching for connection...',
        failure: 'Connection lost'
    }),
    child: Object.freeze({
        appStart: 'Waking up...',
        serverLink: 'Going online...',
        discovery: 'Ready',
        handshake: 'Connecting to parent...',
        active: 'Monitoring',
        interrupted: 'Waiting for signal...',
        failure: 'Check internet'
    })
});

// Initialization
function init() {
    if (!isPeerJsAvailable()) return;
    logBuildFingerprint('init');
    logTurnAvailability();
    restoreLastSession();
    attachEventListeners();
    updateConnectState();
}

function buildTag() {
    return `Build ${config.APP_BUILD_ID}`;
}

function defaultStatusStageForState(state) {
    if (state === 'connected') return 'active';
    if (state === 'waiting') return 'interrupted';
    return 'failure';
}

function statusLabelForStage(stage, state) {
    const roleLabels = STATUS_STAGE_LABELS[role];
    if (roleLabels && roleLabels[stage]) return roleLabels[stage];
    if (state === 'connected') return 'Connected';
    if (state === 'waiting') return 'Waiting';
    if (state === 'alarm') return 'ALARM';
    return 'Disconnected';
}

function logBuildFingerprint(stage) {
    utils.log(`[BUILD] id=${config.APP_BUILD_ID} stage=${stage} url=${window.location.href}`);
}

function logTurnAvailability() {
    const iceServers = config.ICE_SERVERS || [];
    const turnCount = iceServers.reduce((count, server) => {
        const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
        const hasTurn = urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
        return count + (hasTurn ? 1 : 0);
    }, 0);
    if (turnCount > 0) {
        utils.log(`[NET] TURN relay configured. turnServerEntries=${turnCount}`);
    } else {
        utils.log('[NET] TURN relay unavailable (no TURN_CONFIG found). Using direct/STUN only.', true);
    }
}

function setParentConnectionState(nextState, reason = 'unspecified', extra = {}) {
    const prevState = parentConnectionState;
    parentConnectionState = nextState;
    parentLog(`State transition: ${prevState} -> ${nextState} (reason=${reason})`);

    if (nextState === PARENT_CONNECTION_STATES.SIGNALING) {
        setStatusText('waiting', 'serverLink');
        return;
    }
    if (nextState === PARENT_CONNECTION_STATES.NEGOTIATING) {
        setStatusText('waiting', 'handshake');
        return;
    }
    if (nextState === PARENT_CONNECTION_STATES.MEDIA_UP) {
        setStatusText('connected', 'active');
        return;
    }
    if (nextState === PARENT_CONNECTION_STATES.DEGRADED || nextState === PARENT_CONNECTION_STATES.RETRYING) {
        setStatusText('waiting', 'interrupted');
        return;
    }
    if (nextState === PARENT_CONNECTION_STATES.FAILED) {
        setStatusText('disconnected', 'failure');
        return;
    }
}

function logParentAttemptDiagnostic(reasonCode, extra = {}) {
    const diagnostic = {
        reasonCode,
        attempt: parentConnectAttempt,
        roomId,
        targetPeerId: roomId ? `babymonitor-${roomId}-child` : null,
        parentPeerId,
        parentState: parentConnectionState,
        mediaConnected: parentMediaConnected,
        dataOpen: parentDataChannelOpen,
        heartbeatAgeMs: lastHeartbeatAt ? (Date.now() - lastHeartbeatAt) : null,
        turnConfigured: (config.ICE_SERVERS || []).some((server) => {
            const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
            return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url));
        }),
        ...extra
    };
    parentLog(`Diagnostic: ${JSON.stringify(diagnostic)}`, reasonCode !== 'attempt_connected_media' && reasonCode !== 'attempt_connected_data');
}

function hardResetParentPeer(reason) {
    const suffix = Math.random().toString(36).slice(2, 8);
    parentPeerId = `babymonitor-${roomId}-parent-${suffix}`;
    parentPeerResetCount += 1;
    parentLog(`Hard reset parent peer (#${parentPeerResetCount}) reason=${reason} newPeerId=${parentPeerId}`, true);
    setParentConnectionState(PARENT_CONNECTION_STATES.SIGNALING, 'peer-hard-reset', { reason });
    network.createPeer(parentPeerId);
}

function parentLog(message, isError = false) {
    if (selectedRole === 'parent' || role === 'parent') {
        utils.log(`[PARENT] ${message}`, isError);
    }
}

function childLog(message, isError = false) {
    if (selectedRole === 'child' || role === 'child') {
        utils.log(`[CHILD] ${message}`, isError);
    }
}

function formatError(err) {
    if (!err) return 'unknown';
    const parts = [];
    if (err.type) parts.push(`type=${err.type}`);
    if (err.message) parts.push(`message=${err.message}`);
    if (err.name) parts.push(`name=${err.name}`);
    if (err.code != null) parts.push(`code=${err.code}`);
    return parts.length ? parts.join(', ') : String(err);
}

function attachParentPeerConnectionDebug(call) {
    if (!call) return;
    const attach = () => {
        const pc = call.peerConnection;
        if (!pc) return false;
        if (pc.__kgbabyParentDebugAttached) return true;

        pc.__kgbabyParentDebugAttached = true;
        parentLog(`RTCPeerConnection ready: signaling=${pc.signalingState}, ice=${pc.iceConnectionState}, conn=${pc.connectionState}`);

        pc.addEventListener('iceconnectionstatechange', () => {
            parentLog(`ICE state -> ${pc.iceConnectionState}`);
        });
        pc.addEventListener('connectionstatechange', () => {
            parentLog(`Peer connection state -> ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                parentMediaConnected = false;
            }
        });
        pc.addEventListener('signalingstatechange', () => {
            parentLog(`Signaling state -> ${pc.signalingState}`);
        });
        pc.addEventListener('icegatheringstatechange', () => {
            parentLog(`ICE gathering state -> ${pc.iceGatheringState}`);
        });
        pc.addEventListener('icecandidateerror', (e) => {
            parentLog(`ICE candidate error: code=${e.errorCode || 'n/a'} url=${e.url || 'unknown'} text=${e.errorText || ''}`, true);
        });
        pc.addEventListener('track', (e) => {
            parentLog(`RTCPeerConnection track event: kind=${e.track?.kind || 'unknown'}, streams=${e.streams?.length || 0}`);
        });
        return true;
    };

    if (attach()) return;
    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if (attach()) {
            clearInterval(timer);
            return;
        }
        if (attempts >= 20) {
            clearInterval(timer);
            parentLog('RTCPeerConnection not available after 4s on MediaConnection.', true);
        }
    }, 200);
}

function attachChildPeerConnectionDebug(call) {
    if (!call) return;
    const attach = () => {
        const pc = call.peerConnection;
        if (!pc) return false;
        if (pc.__kgbabyChildDebugAttached) return true;

        pc.__kgbabyChildDebugAttached = true;
        childLog(`RTCPeerConnection ready (child): signaling=${pc.signalingState}, ice=${pc.iceConnectionState}, conn=${pc.connectionState}`);

        pc.addEventListener('iceconnectionstatechange', () => {
            childLog(`ICE state (child) -> ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                setStatusText('connected', 'active');
            } else if (pc.iceConnectionState === 'disconnected') {
                setStatusText('waiting', 'interrupted');
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                setStatusText('disconnected', 'failure');
            }
        });
        pc.addEventListener('connectionstatechange', () => {
            childLog(`Peer connection state (child) -> ${pc.connectionState}`);
        });
        return true;
    };

    if (attach()) return;
    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if (attach()) {
            clearInterval(timer);
            return;
        }
        if (attempts >= 10) {
            clearInterval(timer);
        }
    }, 200);
}

function isPeerJsAvailable() {
    if (typeof window.Peer !== 'undefined') return true;
    ui.showScreen('landing');
    elements.btnConnect.disabled = true;
    utils.log('PeerJS failed to load from local vendor file and CDN fallback.', true);
    alert('PeerJS failed to load from local vendor file and CDN fallback. Check local file serving, captive portal, VPN, DNS, or firewall.');
    return false;
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
    elements.btnRetryMic.addEventListener('click', startChildStreaming);
    elements.btnResetParent.addEventListener('click', () => {
        resetParentRetry();
        connectToChild();
    });
    
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

async function runSessionPreflight(roleChoice) {
    const checks = {
        peerLoaded: typeof window.Peer !== 'undefined',
        online: navigator.onLine !== false,
        role: roleChoice,
        audioContextReady: false,
        mediaDevicesReady: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    };

    try {
        const ctx = audio.getAudioContext();
        checks.audioContextReady = !!ctx;
    } catch (err) {
        checks.audioContextReady = false;
    }

    if (roleChoice === 'child' && !checks.mediaDevicesReady) {
        utils.log(`[PREFLIGHT] ${JSON.stringify(checks)}`, true);
        alert('This browser does not support microphone capture APIs required for Child mode.');
        return false;
    }
    if (!checks.peerLoaded) {
        utils.log(`[PREFLIGHT] ${JSON.stringify(checks)}`, true);
        alert('PeerJS is not loaded. Refresh and try again.');
        return false;
    }

    if (!checks.online) {
        utils.log('[PREFLIGHT] Browser reports offline mode. Connect may fail.', true);
    }
    utils.log(`[PREFLIGHT] ${JSON.stringify(checks)}`);
    return true;
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
    const preflightOk = await runSessionPreflight(roleChoice);
    if (!preflightOk) return;
    role = roleChoice;
    currentStatusStage = null;
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
    logBuildFingerprint(`start-${role}`);
    
    // UI Setup
    ui.showScreen('monitor');
    elements.roleDisplay.textContent = `${role === 'child' ? 'Child Unit' : 'Parent Unit'} · ${buildTag()}`;
    elements.monitorScreen.classList.toggle('parent-layout', role === 'parent');
    elements.monitorScreen.classList.toggle('child-layout', role === 'child');
    setStatusText('waiting', 'appStart');
    
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
}

function deriveSessionId(joinCode) {
    const hash = utils.hashString32(joinCode);
    return `code-${hash.toString(36)}`;
}

function setStatusText(state, stage = null) {
    const resolvedState = state || 'disconnected';
    const resolvedStage = stage || currentStatusStage || defaultStatusStageForState(resolvedState);
    currentStatusStage = resolvedStage;
    const baby = displayBabyName || displayJoinCode || '--';
    const idLabel = displayBabyName ? 'Baby' : 'Code';
    const label = statusLabelForStage(resolvedStage, resolvedState);
    let baseText = '';

    if (resolvedState === 'alarm') {
        baseText = 'ALARM · Check baby connection';
    } else {
        baseText = `${label} · ${idLabel}: ${baby}`;
    }
    const fullText = `${baseText} · ${buildTag()}`;
    ui.updateConnectionStatus(resolvedState, fullText);

    if (role === 'parent') {
        parentLog(`Status UI -> ${resolvedState}/${resolvedStage} (${elements.statusText.textContent})`);
    }
}

// Child Flow
async function initChildFlow() {
    const myId = `babymonitor-${roomId}-child`;
    childLog(`Initializing child flow. peerId=${myId}, room=${roomId}`);
    setStatusText('waiting', 'serverLink');
    network.initNetwork({
        onOpen: (id) => {
            utils.log(`Network open. ID: ${id}`);
            childLog(`Peer open. id=${id}`);
            setStatusText('waiting', 'discovery');
            startChildStreaming();
            startHeartbeat();
        },
        onCall: handleIncomingCall,
        onConnection: handleIncomingDataConnection,
        onError: (err) => {
            utils.log(`Network error: ${err.type || 'unknown'} ${err.message ? `- ${err.message}` : ''}`, true);
            childLog(`Peer error: ${formatError(err)}`, true);
            if (err?.type === 'network' || err?.type === 'socket-error' || err?.type === 'server-error') {
                utils.log('Signal server unreachable. Check captive portal/VPN/firewall or use a custom PeerJS host.', true);
            }
            setStatusText('disconnected', 'failure');
            setTimeout(() => location.reload(), 5000);
        },
        onDisconnected: () => {
            childLog('Peer disconnected event fired.', true);
            setStatusText('waiting', 'interrupted');
        },
        onClose: () => {
            childLog('Peer close event fired.', true);
            setStatusText('disconnected', 'failure');
        }
    });
    network.createPeer(myId);
    childLog('Peer object created.');
    
    audio.initAudio({
        onElevatedActivity: (ts) => {
            childLog(`Elevated activity event broadcast. ts=${ts}`);
            network.broadcastToParents({ type: 'elevated', ts });
        },
        onStateChange: (state, confidence) => {
            childLog(`State change broadcast. state=${state} confidence=${confidence ?? 'n/a'}`);
            network.broadcastToParents({ type: 'state', state, confidence, ts: Date.now() });
        }
    });
}

async function startChildStreaming() {
    try {
        elements.btnRetryMic.classList.add('hidden');
        childLog('Starting local audio capture for child stream.');
        const stream = await audio.getLocalStream();
        const tracks = stream?.getTracks?.() || [];
        childLog(`Mic stream ready. tracks=${tracks.length} kinds=${tracks.map(t => t.kind).join(',') || 'none'}`);
        audio.setupVAD(stream, (prefix, analyser) => ui.visualize(prefix, analyser));
        childLog('VAD initialized.');
        const sendStream = audio.setupTransmitChain(stream);
        const sendTracks = sendStream?.getTracks?.() || [];
        childLog(`Transmit chain ready. tracks=${sendTracks.length} kinds=${sendTracks.map(t => t.kind).join(',') || 'none'}`);
        
        // Answer pending calls
        const pending = network.getPendingChildCalls();
        childLog(`Pending unanswered calls queued while mic initializing: ${pending.length}`);
        pending.forEach(call => {
            attachChildPeerConnectionDebug(call);
            call.answer(sendStream);
        });
        if (pending.length > 0) {
            childLog(`Answered ${pending.length} pending calls after mic initialization.`);
        }
        network.setPendingChildCalls([]);
    } catch (err) {
        utils.log(`Mic Error: ${err.message}`, true);
        childLog(`Mic setup failed: ${formatError(err)}`, true);
        elements.btnRetryMic.classList.remove('hidden');
        if (err.name === 'NotAllowedError') {
            alert('Microphone access was denied. Please check site permissions.');
        } else if (err.name === 'NotFoundError') {
            alert('No microphone was found on this device.');
        } else {
            alert('Microphone initialization failed: ' + err.message);
        }
    }
}

function handleIncomingCall(call) {
    childLog(`Incoming media call from peer=${call.peer || 'unknown'}`);
    setStatusText('waiting', 'handshake');
    const stream = audio.setupTransmitChain();
    if (!stream) {
        childLog('Transmit stream not ready yet; queueing incoming call as pending.');
        network.getPendingChildCalls().push(call);
        return;
    }
    childLog('Answering incoming media call with active transmit stream.');
    attachChildPeerConnectionDebug(call);
    call.answer(stream);
    network.getChildCalls().set(call.peer, call);
    childLog(`Active child calls=${network.getChildCalls().size}`);
    setStatusText('connected', 'active');
    
    network.startStatsLoop(call, 'outbound', (stats) => {
        const now = Date.now();
        updateConnectionModeUI(stats);
        if (stats.isPoor || (now - childStatsLastLogAt) > 10000) {
            childStatsLastLogAt = now;
            childLog(`Outbound stats: poor=${stats.isPoor} bitrate=${stats.bitrate ?? 'n/a'} rtt=${stats.rtt ?? 'n/a'} jitter=${stats.jitter ?? 'n/a'} lost=${stats.packetsLost ?? 'n/a'}`);
        }
    });
    childLog('Outbound stats loop started for active call.');
    
    call.on('close', () => {
        childLog(`Media call closed for peer=${call.peer || 'unknown'}.`, true);
        network.getChildCalls().delete(call.peer);
        childLog(`Active child calls=${network.getChildCalls().size}`);
        if (network.getChildCalls().size === 0) setStatusText('waiting', 'interrupted');
    });
    call.on('error', (err) => {
        childLog(`Media call error for peer=${call.peer || 'unknown'}: ${formatError(err)}`, true);
    });
}

function handleIncomingDataConnection(conn) {
    childLog(`Incoming data connection from peer=${conn.peer || 'unknown'} label=${conn.label || 'default'}`);
    network.getParentDataConns().set(conn.peer, conn);
    conn.on('data', (data) => handleChildDataMessage(data));
    conn.on('open', () => {
        utils.log('Parent data channel open');
        childLog(`Data channel open with parent=${conn.peer || 'unknown'}`);
    });
    conn.on('close', () => {
        childLog(`Data channel closed with parent=${conn.peer || 'unknown'}.`, true);
        network.getParentDataConns().delete(conn.peer);
    });
    conn.on('error', (err) => {
        childLog(`Data channel error with parent=${conn.peer || 'unknown'}: ${formatError(err)}`, true);
        network.getParentDataConns().delete(conn.peer);
    });
}

function handleChildDataMessage(data) {
    if (!data || !data.type) {
        childLog(`Malformed data message from parent: ${JSON.stringify(data)}`, true);
        return;
    }
    childLog(`Data message received from parent: type=${data.type}`);
    if (data.type === 'dim') setDimOverlay(!!data.enabled);
}

// Parent Flow
function clearParentDataChannelOpenTimeout() {
    if (!parentDataChannelOpenTimeout) return;
    clearTimeout(parentDataChannelOpenTimeout);
    parentDataChannelOpenTimeout = null;
}

function scheduleParentDataChannelOpenTimeout(conn, reason) {
    clearParentDataChannelOpenTimeout();
    parentDataChannelOpenTimeout = setTimeout(() => {
        if (network.getDataConn() !== conn) return;
        if (conn.open) return;
        parentDataChannelOpen = false;
        parentLog(`Data channel open timeout (${config.DATA_CHANNEL_OPEN_TIMEOUT_MS}ms) after ${reason}. Recreating data channel.`, true);
        if (parentMediaConnected) {
            parentLog('Data path degraded: media connected + data missing.', true);
        } else {
            parentLog('Data path degraded: media disconnected + data missing.', true);
        }
        parentDataMissingLogShown = true;
        createParentDataChannel('open-timeout');
    }, config.DATA_CHANNEL_OPEN_TIMEOUT_MS);
}

function createParentDataChannel(reason) {
    if (reason !== 'initial') {
        parentDataChannelRetryCount += 1;
        parentLog(`Data channel reconnect attempt #${parentDataChannelRetryCount} (${reason}).`);
    }
    const dataConn = network.connectDataChannelToChild(roomId);
    if (!dataConn) {
        parentLog(`network.connectDataChannelToChild returned no data connection during ${reason}.`, true);
        return;
    }

    parentLog(`Data connection created (${reason}). peer=${dataConn.peer || 'unknown'}, label=${dataConn.label || 'default'}`);
    if (dataConn.__kgbabyParentHandlersAttached) {
        if (dataConn.open) {
            parentDataChannelOpen = true;
            clearParentDataChannelOpenTimeout();
        } else {
            scheduleParentDataChannelOpenTimeout(dataConn, reason);
        }
        return;
    }

    dataConn.__kgbabyParentHandlersAttached = true;
    dataConn.on('data', (data) => {
        if (network.getDataConn() !== dataConn) return;
        handleParentDataMessage(data);
    });
    dataConn.on('open', () => {
        if (network.getDataConn() !== dataConn) return;
        utils.log('Data channel open');
        parentDataChannelOpen = true;
        parentDataMissingLogShown = false;
        clearParentDataChannelOpenTimeout();
        parentConsecutiveFailures = 0;
        parentLog(`attempt connected: data channel open (attempt #${parentConnectAttempt})`);
        logParentAttemptDiagnostic('attempt_connected_data');
        alarm.clearAlarmGrace();
    });
    dataConn.on('close', () => {
        if (network.getDataConn() !== dataConn) return;
        parentDataChannelOpen = false;
        parentLog('Data channel closed.', true);
        createParentDataChannel('close');
    });
    dataConn.on('error', (err) => {
        if (network.getDataConn() !== dataConn) return;
        parentDataChannelOpen = false;
        parentLog(`Data channel error: ${formatError(err)}`, true);
        createParentDataChannel('error');
    });

    if (dataConn.open) {
        parentDataChannelOpen = true;
        clearParentDataChannelOpenTimeout();
        parentConsecutiveFailures = 0;
        parentLog(`attempt connected: data channel open (attempt #${parentConnectAttempt})`);
        logParentAttemptDiagnostic('attempt_connected_data');
    } else {
        parentDataChannelOpen = false;
        scheduleParentDataChannelOpenTimeout(dataConn, reason);
    }
}

function initParentFlow() {
    const parentSuffix = Math.random().toString(36).slice(2, 8);
    parentPeerId = `babymonitor-${roomId}-parent-${parentSuffix}`;
    parentLog(`Initializing parent flow. peerId=${parentPeerId}, room=${roomId}`);
    clearParentDataChannelOpenTimeout();
    parentDataChannelRetryCount = 0;
    parentConsecutiveFailures = 0;
    parentPeerResetCount = 0;
    parentHeartbeatAlarmActive = false;
    parentMediaConnected = false;
    parentLastMediaActivityAt = 0;
    setParentConnectionState(PARENT_CONNECTION_STATES.SIGNALING, 'parent-flow-init');
    
    network.initNetwork({
        onOpen: (id) => {
            utils.log(`Network open. ID: ${id}`);
            parentLog(`Peer open. id=${id}. Beginning child connect sequence.`);
            setParentConnectionState(PARENT_CONNECTION_STATES.SIGNALING, 'peer-open');
            setStatusText('waiting', 'discovery');
            resetParentRetry();
            connectToChild();
        },
        onError: (err) => {
            utils.log(`Network error: ${err.type || 'unknown'} ${err.message ? `- ${err.message}` : ''}`, true);
            parentLog(`Peer error: ${formatError(err)}`, true);
            if (err?.type === 'peer-unavailable') {
                parentLog(`attempt failed: peer-unavailable (attempt #${parentConnectAttempt})`, true);
            }
            if (err?.type === 'network' || err?.type === 'socket-error' || err?.type === 'server-error') {
                utils.log('Signal server unreachable. Check captive portal/VPN/firewall or use a custom PeerJS host.', true);
            }
            setParentConnectionState(PARENT_CONNECTION_STATES.DEGRADED, 'peer-error', { errorType: err?.type || 'unknown' });
            logParentAttemptDiagnostic(`peer_error_${err?.type || 'unknown'}`, { error: formatError(err) });
            retryParentConnection();
        },
        onDisconnected: () => {
            parentLog('Peer disconnected event fired.', true);
            setParentConnectionState(PARENT_CONNECTION_STATES.DEGRADED, 'peer-disconnected');
            logParentAttemptDiagnostic('peer_disconnected');
            retryParentConnection();
        },
        onClose: () => {
            parentLog('Peer close event fired.', true);
            setParentConnectionState(PARENT_CONNECTION_STATES.FAILED, 'peer-close');
            logParentAttemptDiagnostic('peer_close');
            retryParentConnection();
        }
    });
    network.createPeer(parentPeerId);
    parentLog('Peer object created.');
    
    alarm.initAlarm();
    startHeartbeatWatchdog();
}

function connectToChild() {
    parentConnectAttempt += 1;
    parentMediaConnected = false;
    parentDataChannelOpen = false;
    parentDataMissingLogShown = false;
    parentLastMediaActivityAt = 0;
    setParentConnectionState(PARENT_CONNECTION_STATES.NEGOTIATING, 'connect-attempt-start');
    const targetId = `babymonitor-${roomId}-child`;
    parentLog(`Connect attempt #${parentConnectAttempt} to child peer ${targetId}`);
    try {
        const silentDestination = audio.getAudioContext().createMediaStreamDestination();
        const silentTrackCount = silentDestination.stream?.getAudioTracks?.().length || 0;
        parentLog(`Created silent upstream stream for call bootstrap. tracks=${silentTrackCount}`);

        const call = network.connectToChild(roomId, silentDestination.stream);
        if (!call) {
            parentLog('network.connectToChild returned no call object (peer not ready?).', true);
            setParentConnectionState(PARENT_CONNECTION_STATES.DEGRADED, 'missing-call-object');
            logParentAttemptDiagnostic('missing_call_object');
            retryParentConnection();
            return;
        }
        parentLog(`MediaConnection created. peer=${call.peer || 'unknown'}`);
        
        handleParentCall(call);
        attachParentPeerConnectionDebug(call);

        createParentDataChannel('initial');
    } catch (err) {
        parentLog(`Bootstrap stream creation/connect setup failed: ${formatError(err)}`, true);
        setParentConnectionState(PARENT_CONNECTION_STATES.DEGRADED, 'bootstrap-failure');
        logParentAttemptDiagnostic('bootstrap_failure', { error: formatError(err) });
        retryParentConnection();
    }
}

let lastCandidateTypeReported = null;
function updateConnectionModeUI(stats) {
    if (!elements.connectionMode) return;
    
    if (stats && stats.candidateType) {
        const type = stats.candidateType;
        
        if (type !== lastCandidateTypeReported) {
            const logMsg = `ICE Path established via: ${type.toUpperCase()}`;
            if (role === 'child') childLog(logMsg);
            else parentLog(logMsg);
            lastCandidateTypeReported = type;
        }

        if (type === 'host' || type === 'srflx') {
            elements.connectionMode.textContent = 'Mode: Direct (Private)';
            elements.connectionMode.style.color = '#7bf1b6';
        } else if (type === 'relay') {
            elements.connectionMode.textContent = 'Mode: Relay (Metered)';
            elements.connectionMode.style.color = '#ffd576';
        } else {
            elements.connectionMode.textContent = `Mode: ${type}`;
            elements.connectionMode.style.color = '';
        }
    } else {
        elements.connectionMode.textContent = 'Mode: --';
        elements.connectionMode.style.color = '';
    }
}

function handleParentCall(call) {
    parentLog('Binding MediaConnection handlers.');
    call.on('stream', (stream) => {
        utils.log('Audio stream received');
        const tracks = stream?.getTracks?.() || [];
        const trackKinds = tracks.map(t => t.kind).join(',') || 'none';
        parentLog(`Remote stream received. tracks=${tracks.length}, kinds=${trackKinds}`);
        parentMediaConnected = true;
        parentLastMediaActivityAt = Date.now();
        parentHeartbeatAlarmActive = false;
        parentConsecutiveFailures = 0;
        parentLog(`attempt connected: media stream received (attempt #${parentConnectAttempt})`);
        setParentConnectionState(PARENT_CONNECTION_STATES.MEDIA_UP, 'media-stream-received');
        logParentAttemptDiagnostic('attempt_connected_media', { tracks: tracks.length });
        audio.startPlayback(stream, (prefix, analyser) => ui.visualize(prefix, analyser))
            .then(() => parentLog('Remote audio playback started.'))
            .catch((err) => parentLog(`Remote audio playback failed: ${formatError(err)}`, true));
    });
    
    call.on('close', () => {
        parentLog('MediaConnection close event fired.', true);
        parentMediaConnected = false;
        setParentConnectionState(PARENT_CONNECTION_STATES.DEGRADED, 'media-close');
        logParentAttemptDiagnostic('media_close');
        retryParentConnection();
    });

    call.on('error', (err) => {
        parentLog(`MediaConnection error: ${formatError(err)}`, true);
        parentMediaConnected = false;
        setParentConnectionState(PARENT_CONNECTION_STATES.DEGRADED, 'media-error');
        logParentAttemptDiagnostic('media_error', { error: formatError(err) });
        retryParentConnection();
    });
    
    network.startStatsLoop(call, 'inbound', (stats) => {
        const now = Date.now();
        updateConnectionModeUI(stats);
        if (parentMediaConnected) {
            parentLastMediaActivityAt = now;
        }
        if (stats.isPoor || stats.silenceDetected || (now - parentStatsLastLogAt) > 10000) {
            parentStatsLastLogAt = now;
            parentLog(`Inbound stats: poor=${stats.isPoor} silence=${stats.silenceDetected} bitrate=${stats.bitrate ?? 'n/a'} rtt=${stats.rtt ?? 'n/a'} jitter=${stats.jitter ?? 'n/a'} lost=${stats.packetsLost ?? 'n/a'}`);
        }
        if (stats.silenceDetected) {
            elements.audioStatus.textContent = "Silence detected. Check child unit.";
        }
    });
    parentLog('Inbound stats loop started.');
}

function handleParentDataMessage(data) {
    if (!data || !data.type) {
        parentLog(`Received malformed data message: ${JSON.stringify(data)}`, true);
        return;
    }
    parentDataChannelOpen = true;
    parentDataMissingLogShown = false;
    if (data.type === 'heartbeat') {
        lastHeartbeatAt = Date.now();
        parentHeartbeatCount += 1;
        parentHeartbeatAlarmActive = false;
        if (parentHeartbeatWarningShown) {
            parentHeartbeatWarningShown = false;
            parentLog('Heartbeat restored after warning.');
        }
        if (parentHeartbeatCount % 5 === 0) {
            parentLog(`Heartbeat received (${parentHeartbeatCount} total).`);
        }
        alarm.clearAlarmGrace();
    }
    if (data.type !== 'heartbeat') {
        parentLog(`Data message received: type=${data.type}`);
    }
    if (data.type === 'elevated') handleElevatedEvent(data.ts);
    if (data.type === 'state') handleStateEvent(data.state);
    if (data.type === 'dim') {
        parentLog(`Dim sync received from child: enabled=${!!data.enabled}`);
    }
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
    if (parentRetryTimeout) {
        parentLog(`Retry already scheduled. delay=${parentRetryDelay/1000}s`);
        return;
    }
    parentConsecutiveFailures += 1;
    setParentConnectionState(PARENT_CONNECTION_STATES.RETRYING, 'retry-scheduled');
    logParentAttemptDiagnostic('retry_scheduled', {
        consecutiveFailures: parentConsecutiveFailures,
        delayMs: parentRetryDelay
    });
    if (parentConsecutiveFailures >= PARENT_MAX_CONSECUTIVE_FAILURES_BEFORE_PEER_RESET) {
        parentConsecutiveFailures = 0;
        hardResetParentPeer('max-consecutive-failures');
        resetParentRetry();
        return;
    }
    utils.log(`Retrying connection in ${parentRetryDelay/1000}s...`);
    parentLog(`Scheduling retry in ${parentRetryDelay/1000}s.`);
    parentRetryTimeout = setTimeout(() => {
        parentRetryTimeout = null;
        parentLog('Retry timer fired; reconnecting now.');
        connectToChild();
        parentRetryDelay = Math.min(parentRetryDelay * 2, 30000);
        parentLog(`Next retry backoff set to ${parentRetryDelay/1000}s.`);
    }, parentRetryDelay);
}

function resetParentRetry() {
    if (parentRetryTimeout) clearTimeout(parentRetryTimeout);
    parentRetryTimeout = null;
    parentRetryDelay = 3000;
    parentConsecutiveFailures = 0;
    parentLog('Retry backoff reset to 3s.');
}

// Heartbeat
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    childHeartbeatCount = 0;
    childLog(`Heartbeat sender started. interval=${config.HEARTBEAT_INTERVAL_MS}ms`);
    heartbeatInterval = setInterval(() => {
        childHeartbeatCount += 1;
        const openParents = Array.from(network.getParentDataConns().values()).filter((conn) => conn && conn.open).length;
        if (childHeartbeatCount % 5 === 0 || openParents === 0) {
            childLog(`Heartbeat sent (${childHeartbeatCount} total). openParents=${openParents}`);
        }
        network.broadcastToParents({ type: 'heartbeat', ts: Date.now() });
    }, config.HEARTBEAT_INTERVAL_MS);
}

function startHeartbeatWatchdog() {
    lastHeartbeatAt = Date.now();
    parentLog(`Heartbeat watchdog started. interval=${config.HEARTBEAT_INTERVAL_MS}ms timeout=${config.HEARTBEAT_TIMEOUT_MS}ms`);
    setInterval(() => {
        const nowMs = Date.now();
        const decision = shouldTriggerParentAlarm({
            nowMs,
            lastHeartbeatAtMs: lastHeartbeatAt,
            lastMediaActivityAtMs: parentLastMediaActivityAt,
            heartbeatTimeoutMs: config.HEARTBEAT_TIMEOUT_MS,
            statsIntervalMs: config.STATS_INTERVAL_MS,
            parentMediaConnected
        });

        if (decision.heartbeatStale && decision.mediaHealthy) {
            if (!parentHeartbeatWarningShown) {
                parentHeartbeatWarningShown = true;
                parentLog(`Heartbeat stale (${Math.round(decision.heartbeatAgeMs / 1000)}s) but media healthy (${Math.round(decision.mediaAgeMs / 1000)}s). Suppressing alarm.`, true);
            }
            if (!parentDataChannelOpen && !parentDataMissingLogShown) {
                parentDataMissingLogShown = true;
                parentLog('Heartbeat missing while media connected (media connected + data missing).', true);
            }
            parentHeartbeatAlarmActive = false;
            return;
        }

        if (!decision.heartbeatStale) {
            if (parentHeartbeatWarningShown) {
                parentHeartbeatWarningShown = false;
                parentLog('Heartbeat recovered and watchdog warning cleared.');
            }
            parentHeartbeatAlarmActive = false;
            return;
        }

        if (!parentDataChannelOpen && !parentDataMissingLogShown) {
            parentDataMissingLogShown = true;
            parentLog('Heartbeat missing while media disconnected (media disconnected + data missing).', true);
        }

        if (decision.shouldAlarm && !parentHeartbeatAlarmActive) {
            parentHeartbeatAlarmActive = true;
            parentHeartbeatWarningShown = true;
            parentLog(`Heartbeat timeout (${Math.round(decision.heartbeatAgeMs / 1000)}s) with unhealthy media. Triggering alarm.`, true);
            setParentConnectionState(PARENT_CONNECTION_STATES.FAILED, 'watchdog-timeout');
            logParentAttemptDiagnostic('watchdog_timeout', {
                heartbeatAgeMs: decision.heartbeatAgeMs,
                mediaAgeMs: decision.mediaAgeMs
            });
            alarm.scheduleAlarm('Connection lost (Heartbeat timeout + media unhealthy)');
            retryParentConnection();
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
    if (enabled) {
        ui.stopVisualizer();
    } else if (role === 'child') {
        // Re-start visualizer if child wakes up
        const stream = audio.getAudioContext();
        // The VAD setup already handles the analyzer, we just need to re-bind the UI draw loop
    }
}

function sendDimStateFromChild(enabled) {
    network.broadcastToParents({ type: 'dim', enabled, source: 'child' });
}

function stopSession() {
    clearParentDataChannelOpenTimeout();
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

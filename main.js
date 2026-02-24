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

// Initialization
function init() {
    if (!isPeerJsAvailable()) return;
    logBuildFingerprint('init');
    restoreLastSession();
    attachEventListeners();
    updateConnectState();
}

function buildTag() {
    return `Build ${config.APP_BUILD_ID}`;
}

function logBuildFingerprint(stage) {
    utils.log(`[BUILD] id=${config.APP_BUILD_ID} stage=${stage} url=${window.location.href}`);
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
                setStatusText('connected');
            } else if (pc.iceConnectionState === 'failed') {
                setStatusText('disconnected');
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
    logBuildFingerprint(`start-${role}`);
    
    // UI Setup
    ui.showScreen('monitor');
    elements.roleDisplay.textContent = `${role === 'child' ? 'Child Unit' : 'Parent Unit'} · ${buildTag()}`;
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
    let baseText = '';
    
    if (state === 'alarm') {
        baseText = 'ALARM · Check baby connection';
    } else if (role === 'parent' && state === 'connected') {
        baseText = `Audio connected · Spying on ${baby}`;
    } else {
        baseText = `${label} · ${idLabel}: ${baby}`;
    }
    elements.statusText.textContent = `${baseText} · ${buildTag()}`;
    
    ui.updateConnectionStatus(state);
    if (role === 'parent') {
        parentLog(`Status UI -> ${state} (${elements.statusText.textContent})`);
    }
}

// Child Flow
async function initChildFlow() {
    const myId = `babymonitor-${roomId}-child`;
    childLog(`Initializing child flow. peerId=${myId}, room=${roomId}`);
    network.initNetwork({
        onOpen: (id) => {
            utils.log(`Network open. ID: ${id}`);
            childLog(`Peer open. id=${id}`);
            setStatusText('waiting');
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
            setStatusText('disconnected');
            setTimeout(() => location.reload(), 5000);
        },
        onDisconnected: () => {
            childLog('Peer disconnected event fired.', true);
            setStatusText('disconnected');
        },
        onClose: () => {
            childLog('Peer close event fired.', true);
            setStatusText('disconnected');
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
        alert('Microphone access denied: ' + err.message);
    }
}

function handleIncomingCall(call) {
    childLog(`Incoming media call from peer=${call.peer || 'unknown'}`);
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
    setStatusText('connected');
    
    network.startStatsLoop(call, 'outbound', (stats) => {
        const now = Date.now();
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
        if (network.getChildCalls().size === 0) setStatusText('waiting');
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
        parentLog(`attempt connected: data channel open (attempt #${parentConnectAttempt})`);
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
        parentLog(`attempt connected: data channel open (attempt #${parentConnectAttempt})`);
    } else {
        parentDataChannelOpen = false;
        scheduleParentDataChannelOpenTimeout(dataConn, reason);
    }
}

function initParentFlow() {
    const parentSuffix = Math.random().toString(36).slice(2, 8);
    const myId = `babymonitor-${roomId}-parent-${parentSuffix}`;
    parentLog(`Initializing parent flow. peerId=${myId}, room=${roomId}`);
    clearParentDataChannelOpenTimeout();
    parentDataChannelRetryCount = 0;
    parentHeartbeatAlarmActive = false;
    parentMediaConnected = false;
    parentLastMediaActivityAt = 0;
    
    network.initNetwork({
        onOpen: (id) => {
            utils.log(`Network open. ID: ${id}`);
            parentLog(`Peer open. id=${id}. Beginning child connect sequence.`);
            setStatusText('waiting');
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
            setStatusText('disconnected');
            retryParentConnection();
        },
        onDisconnected: () => {
            parentLog('Peer disconnected event fired.', true);
            setStatusText('disconnected');
        },
        onClose: () => {
            parentLog('Peer close event fired.', true);
            setStatusText('disconnected');
        }
    });
    network.createPeer(myId);
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
    const targetId = `babymonitor-${roomId}-child`;
    parentLog(`Connect attempt #${parentConnectAttempt} to child peer ${targetId}`);
    const silentDestination = audio.createMediaStreamDestination();
    const silentTrackCount = silentDestination.stream?.getAudioTracks?.().length || 0;
    parentLog(`Created silent upstream stream for call bootstrap. tracks=${silentTrackCount}`);

    const call = network.connectToChild(roomId, silentDestination.stream);
    if (!call) {
        parentLog('network.connectToChild returned no call object (peer not ready?).', true);
        return;
    }
    parentLog(`MediaConnection created. peer=${call.peer || 'unknown'}`);
    
    handleParentCall(call);
    attachParentPeerConnectionDebug(call);

    createParentDataChannel('initial');
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
        parentLog(`attempt connected: media stream received (attempt #${parentConnectAttempt})`);
        setStatusText('connected');
        audio.startPlayback(stream, (prefix, analyser) => ui.visualize(prefix, analyser))
            .then(() => parentLog('Remote audio playback started.'))
            .catch((err) => parentLog(`Remote audio playback failed: ${formatError(err)}`, true));
    });
    
    call.on('close', () => {
        parentLog('MediaConnection close event fired.', true);
        parentMediaConnected = false;
        setStatusText('waiting');
        retryParentConnection();
    });

    call.on('error', (err) => {
        parentLog(`MediaConnection error: ${formatError(err)}`, true);
        parentMediaConnected = false;
    });
    
    network.startStatsLoop(call, 'inbound', (stats) => {
        const now = Date.now();
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
            alarm.scheduleAlarm('Connection lost (Heartbeat timeout + media unhealthy)');
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

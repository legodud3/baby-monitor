import { 
    PEER_CONFIG, 
    BITRATE_LEVELS, 
    BITRATE_DEFAULT_INDEX, 
    BITRATE_STEP_DOWN_AFTER, 
    BITRATE_STEP_UP_AFTER, 
    STATS_INTERVAL_MS, 
    SILENCE_WARN_MS 
} from './config.js';
import { log } from './utils.js';

let peer = null;
let dataConn = null;
let parentDataConns = new Map();
let childCalls = new Map();
let pendingChildCalls = [];
let currentCall = null;

let peerReconnectTimer = null;
let statsInterval = null;
let statsLoopRunning = false;
let lastStats = null;
let lastAudioEnergy = null;
let lastAudioEnergyTs = null;

// Callbacks
let callbacks = {};

/**
 * Initializes the network module with event callbacks.
 * @param {Object} cb 
 */
export function initNetwork(cb) {
    callbacks = cb;
}

/**
 * Creates a new PeerJS instance and binds event listeners.
 * @param {string} id - The Peer ID.
 * @returns {Peer}
 */
export function createPeer(id) {
    if (peer) peer.destroy();
    peer = new Peer(id, PEER_CONFIG);
    
    peer.on('open', (id) => callbacks.onOpen(id));
    peer.on('call', (call) => callbacks.onCall(call));
    peer.on('connection', (conn) => callbacks.onConnection(conn));
    peer.on('error', (err) => callbacks.onError(err));
    peer.on('disconnected', () => callbacks.onDisconnected());
    peer.on('close', () => callbacks.onClose());
    
    return peer;
}

/**
 * Initiates a media call to the child unit.
 * @param {string} roomId 
 * @param {MediaStream} silentStream - A silent stream to bootstrap the call.
 * @returns {MediaConnection}
 */
export function connectToChild(roomId, silentStream) {
    if (!peer) return;
    if (currentCall) currentCall.close();

    const targetId = `babymonitor-${roomId}-child`;
    log(`Calling Child (${targetId})...`, false);

    currentCall = peer.call(targetId, silentStream);
    return currentCall;
}

/**
 * Initiates a data connection to the child unit.
 * @param {string} roomId 
 * @returns {DataConnection}
 */
export function connectDataChannelToChild(roomId) {
    const targetId = `babymonitor-${roomId}-child`;
    if (dataConn && dataConn.open) return dataConn;
    if (dataConn) dataConn.close();
    
    dataConn = peer.connect(targetId, { reliable: true });
    return dataConn;
}

/**
 * Broadcasts data to all connected parent units (used by Child).
 * @param {any} data 
 */
export function broadcastToParents(data) {
    parentDataConns.forEach((conn, peerId) => {
        if (!conn || !conn.open) {
            parentDataConns.delete(peerId);
            return;
        }
        try {
            conn.send(data);
        } catch (err) {
            parentDataConns.delete(peerId);
            log(`Failed to send data to parent ${peerId}`, true);
        }
    });
}

/**
 * Sends data to the child unit (used by Parent).
 * @param {any} data 
 */
export function sendToChild(data) {
    if (dataConn && dataConn.open) {
        dataConn.send(data);
    }
}

export function getPeer() { return peer; }
export function getDataConn() { return dataConn; }
export function getParentDataConns() { return parentDataConns; }
export function getChildCalls() { return childCalls; }
export function getPendingChildCalls() { return pendingChildCalls; }
export function setPendingChildCalls(val) { pendingChildCalls = val; }

/**
 * Starts a statistics collection loop for an active call.
 * @param {MediaConnection} call 
 * @param {'outbound'|'inbound'} direction 
 * @param {Function} onStatsUpdate - Callback with stats object.
 */
export function startStatsLoop(call, direction, onStatsUpdate) {
    if (!call || !call.peerConnection) return;
    if (statsInterval) clearInterval(statsInterval);
    statsLoopRunning = false;
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
            let candidateType = candidatePair ? stats.get(candidatePair.remoteCandidateId)?.candidateType : null;

            if (lastStats && bytes != null) {
                const timeDelta = (now - lastStats.timeMs) / 1000;
                const bytesDelta = bytes - lastStats.bytes;
                if (timeDelta > 0 && bytesDelta >= 0) {
                    bitrate = Math.round((bytesDelta * 8) / timeDelta);
                }
            }

            if (bytes != null) lastStats = { timeMs: now, bytes };

            const lossRatio = packetsReceived ? packetsLost / Math.max(1, packetsReceived + packetsLost) : 0;
            const isPoor = (lossRatio > 0.05) || (rtt != null && rtt > 0.35);
            
            if (isPoor) {
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

            const silenceDetected = (inbound && inbound.totalAudioEnergy != null) ? checkSilence(inbound.totalAudioEnergy, now) : false;

            if (onStatsUpdate) {
                onStatsUpdate({
                    isPoor,
                    bitrate,
                    rtt,
                    jitter,
                    packetsLost,
                    silenceDetected,
                    candidateType
                });
            }
        } finally {
            statsLoopRunning = false;
        }
    }, STATS_INTERVAL_MS);
}

function checkSilence(totalEnergy, now) {
    if (lastAudioEnergy != null) {
        const energyDelta = totalEnergy - lastAudioEnergy;
        if (energyDelta < 0.0001 && (now - lastAudioEnergyTs) > SILENCE_WARN_MS) {
            return true;
        } else if (energyDelta >= 0.0001) {
            lastAudioEnergyTs = now;
        }
    } else {
        lastAudioEnergyTs = now;
    }
    lastAudioEnergy = totalEnergy;
    return false;
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

export function stopStatsLoop() {
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = null;
}

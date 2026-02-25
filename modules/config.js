// Consolidated Configuration and Constants

const runtime = typeof window !== 'undefined' ? window : globalThis;
const runtimeCry = runtime?.CRY_CONFIG || {};
const runtimeNetwork = runtime?.NETWORK_CONFIG || {};
const runtimeTurn = runtime?.TURN_CONFIG || null;
export const APP_BUILD_ID = runtime?.APP_BUILD_ID || '2026-02-25.3';

export const CRY_CONFIG = {
    sustainedSeconds: 1.5,
    minDbAboveNoise: 12,
    cooldownSeconds: 10,
    noiseFloorWindowSeconds: 8,
    noiseFloorUpdateMarginDb: 3,
    needsCareSustainedSeconds: 120,
    nonCriticalStateMinHoldSeconds: 60,
    ...runtimeCry
};

export const NETWORK_CONFIG = {
    lowBandwidth: true,
    bitrateLevelsKbps: [32, 48, 64],
    lowBandwidthLevelsKbps: [12, 24, 48],
    ...runtimeNetwork
};

export const BITRATE_LEVELS = (NETWORK_CONFIG.lowBandwidth ? NETWORK_CONFIG.lowBandwidthLevelsKbps : NETWORK_CONFIG.bitrateLevelsKbps)
    .map(kbps => Math.max(8, kbps) * 1000);

export const BITRATE_DEFAULT_INDEX = Math.min(2, BITRATE_LEVELS.length - 1);
export const BITRATE_STEP_DOWN_AFTER = 3; // consecutive bad intervals
export const BITRATE_STEP_UP_AFTER = 4; // consecutive good intervals

const baseIceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] },
    { urls: ['stun:stun4.l.google.com:19302', 'stun:stun.services.mozilla.com'] }
];

const turnIceServers = [];
if (runtimeTurn) {
    const turnEntries = Array.isArray(runtimeTurn) ? runtimeTurn : [runtimeTurn];
    turnEntries.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'string') {
            turnIceServers.push({ urls: entry });
            return;
        }
        if (entry.urls) {
            const server = { urls: entry.urls };
            if (entry.username) server.username = entry.username;
            if (entry.credential) server.credential = entry.credential;
            turnIceServers.push(server);
        }
    });
}

export const ICE_SERVERS = [...baseIceServers, ...turnIceServers];

const basePeerConfig = {
    debug: 2,
    secure: true,
    config: {
        iceServers: ICE_SERVERS
    }
};

const runtimePeer = runtime?.PEER_CONFIG || {};
export const PEER_CONFIG = {
    ...basePeerConfig,
    ...runtimePeer,
    config: {
        ...basePeerConfig.config,
        ...(runtimePeer.config || {})
    }
};

export const VAD_HOLD_TIME = 2000; // ms to keep mic open after noise stops
export const VAD_MIN_DB_ABOVE_NOISE = Math.max(6, CRY_CONFIG.minDbAboveNoise - 4);

export const STATE_THRESHOLDS = {
    stirringDbAboveNoise: Math.max(4, VAD_MIN_DB_ABOVE_NOISE - 2),
    needsCareDbAboveNoise: CRY_CONFIG.minDbAboveNoise,
    settleSeconds: 30,
    stirringSeconds: 2,
    needsCareSustainedSeconds: Math.max(1, Number(CRY_CONFIG.needsCareSustainedSeconds) || 120),
    nonCriticalStateMinHoldSeconds: Math.max(1, Number(CRY_CONFIG.nonCriticalStateMinHoldSeconds) || 60)
};

export const STORAGE_PREFIX = 'kgbaby';
export const STORAGE_VERSION = 'v1';
export const LAST_BABY_NAME_KEY = `${STORAGE_PREFIX}:lastBabyName`;
export const LAST_JOIN_CODE_KEY = `${STORAGE_PREFIX}:lastJoinCode`;

export const MAX_LOG_ENTRIES = 200;
export const STATS_INTERVAL_MS = 2500;
export const SILENCE_WARN_MS = 12000;
export const HEARTBEAT_INTERVAL_MS = 3000;
export const HEARTBEAT_TIMEOUT_MS = 15000;
export const DATA_CHANNEL_OPEN_TIMEOUT_MS = 8000;
export const DATA_CHANNEL_ALARM_GRACE_MS = 5000;
export const PARENT_PEER_HARD_RESET_MS = 10000;

export const WHITE_NOISE_CANCEL_GAIN = 1.0;
export const MIC_BOOST_GAIN = 3.0;

export const SHUSH_MAX_RECORD_MS = 10000;
export const ANIMAL_ALIASES = [
    'otter', 'panda', 'koala', 'fox', 'seal', 'dolphin', 'tiger', 'lion',
    'sloth', 'lemur', 'penguin', 'falcon', 'sparrow', 'rabbit', 'alpaca', 'yak',
    'beaver', 'badger', 'gecko', 'whale', 'manta', 'narwhal', 'owl', 'swan',
    'orca', 'moose', 'bison', 'zebra', 'elephant', 'jaguar', 'hedgehog', 'meerkat'
];

import { 
    CRY_CONFIG, 
    VAD_MIN_DB_ABOVE_NOISE, 
    MIC_BOOST_GAIN, 
    STATE_THRESHOLDS,
    WHITE_NOISE_CANCEL_GAIN 
} from './config.js';
import { log } from './utils.js';
import { elements } from './ui.js';

let audioCtx = null;
let gainNode = null;
let analyser = null;
let vadTrack = null;
let vadInterval = null;
let lastNoiseTime = 0;
let isTransmitting = true;
let lastVadSampleTs = null;
let noiseFloorDb = null;
let elevatedStartTsForAlert = null;
let elevatedCooldownUntil = 0;
let elevatedStartTs = null;
let currentInfantState = 'zzz';
let lastNonCriticalStateSentAt = 0;

let sendStream = null;
let sendTrack = null;
let micGainNode = null;
let transmitMixNode = null;

// Callbacks
let onElevatedActivity = null;
let onStateChange = null;

export function initAudio(callbacks = {}) {
    onElevatedActivity = callbacks.onElevatedActivity;
    onStateChange = callbacks.onStateChange;
}

export async function getLocalStream() {
    log("Requesting Mic...", false);
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });
    log(`Mic Active. Tracks: ${stream.getTracks().length}`, false);
    return stream;
}

export function setupVAD(stream, visualizeCallback) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (vadTrack) vadTrack.stop();
    vadTrack = stream.getAudioTracks()[0].clone();
    const vadStream = new MediaStream([vadTrack]);
    const source = audioCtx.createMediaStreamSource(vadStream);
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    if (vadInterval) clearInterval(vadInterval);
    
    if (visualizeCallback) visualizeCallback('child', analyser);

    let logCounter = 0;
    lastVadSampleTs = Date.now();
    vadInterval = setInterval(() => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const levelDb = rmsToDb(rms);
        const now = Date.now();
        const dt = lastVadSampleTs ? (now - lastVadSampleTs) : 100;
        lastVadSampleTs = now;

        noiseFloorDb = updateNoiseFloor(levelDb, dt, noiseFloorDb);
        maybeDetectElevatedActivity(levelDb, now);
        updateInfantState(levelDb, now);
        
        const vadThresholdDb = noiseFloorDb !== null ? noiseFloorDb + VAD_MIN_DB_ABOVE_NOISE : null;
        if (vadThresholdDb !== null && levelDb >= vadThresholdDb) {
            lastNoiseTime = now;
        }
        
        if (logCounter % 100 === 0) {
            console.log(`VAD: dB=${levelDb.toFixed(1)}, Threshold=${vadThresholdDb !== null ? vadThresholdDb.toFixed(1) : 'n/a'}, Active=${isTransmitting}`);
        }
        logCounter++;

        if (!isTransmitting) {
            ensureTransmission(true);
        }

    }, 100);
}

export function setupTransmitChain(stream, whiteNoiseCancelGainNode = null) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!stream) {
        // Child incoming calls can arrive after mic init; reuse existing send stream.
        return sendStream || null;
    }
    if (typeof stream.getAudioTracks !== 'function' || stream.getAudioTracks().length === 0) {
        log('Invalid mic stream for transmit chain', true);
        return sendStream || null;
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
    
    if (whiteNoiseCancelGainNode) {
        try { whiteNoiseCancelGainNode.disconnect(); } catch (e) {}
        whiteNoiseCancelGainNode.connect(transmitMixNode);
    }
    
    transmitMixNode.connect(destination);

    sendStream = destination.stream;
    sendTrack = sendStream.getAudioTracks()[0];
    ensureTransmission(true);
    
    return sendStream;
}

export function ensureTransmission(enabled) {
    if (!sendTrack) return;
    sendTrack.enabled = enabled;
    isTransmitting = enabled;
}

export function rmsToDb(rms) {
    const safe = Math.max(1, rms);
    return 20 * Math.log10(safe / 255);
}

export function updateNoiseFloor(levelDb, dtMs, currentFloor) {
    if (!Number.isFinite(levelDb)) return currentFloor;
    if (currentFloor === null) return levelDb;
    
    const windowMs = Math.max(1000, CRY_CONFIG.noiseFloorWindowSeconds * 1000);
    const alpha = 1 - Math.exp(-dtMs / windowMs);
    
    if (levelDb < currentFloor + CRY_CONFIG.noiseFloorUpdateMarginDb) {
        return currentFloor + alpha * (levelDb - currentFloor);
    }
    return currentFloor;
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
            if (onElevatedActivity) onElevatedActivity(now);
            log('Elevated audio detected', false);
            elevatedCooldownUntil = now + (CRY_CONFIG.cooldownSeconds * 1000);
            elevatedStartTsForAlert = null;
        }
    } else {
        elevatedStartTsForAlert = null;
    }
}

function updateInfantState(levelDb, now) {
    if (!Number.isFinite(levelDb) || noiseFloorDb === null) return;
    const above = levelDb - noiseFloorDb;

    if (above >= STATE_THRESHOLDS.needsCareDbAboveNoise) {
        if (!elevatedStartTs) elevatedStartTs = now;
        const elapsed = now - elevatedStartTs;
        if (elapsed >= STATE_THRESHOLDS.needsCareSustainedSeconds * 1000) {
            setChildState('needsCare', 0.9, now);
        } else if (elapsed >= STATE_THRESHOLDS.stirringSeconds * 1000) {
            setChildState('stirring', 0.7, now);
        }
        return;
    }

    elevatedStartTs = null;

    if (above >= STATE_THRESHOLDS.stirringDbAboveNoise) {
        setChildState('stirring', 0.6, now);
        return;
    }

    const sinceLastNoise = now - lastNoiseTime;
    if (sinceLastNoise >= STATE_THRESHOLDS.settleSeconds * 1000) {
        setChildState('zzz', 0.8, now);
    } else {
        setChildState('settled', 0.65, now);
    }
}

function setChildState(nextState, confidence = null, now = Date.now()) {
    if (currentInfantState === nextState) return;
    if (nextState !== 'needsCare') {
        const minGapMs = STATE_THRESHOLDS.nonCriticalStateMinHoldSeconds * 1000;
        if (lastNonCriticalStateSentAt && now - lastNonCriticalStateSentAt < minGapMs) return;
        lastNonCriticalStateSentAt = now;
    }
    currentInfantState = nextState;
    if (onStateChange) onStateChange(nextState, confidence);
}

export function startPlayback(stream, visualizeCallback) {
    const remoteAudio = document.getElementById('remote-audio');
    if (!remoteAudio) return;

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
    
    if (visualizeCallback) visualizeCallback('parent', analyser);

    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    return remoteAudio.play();
}

export function teardownAudioGraph() {
    if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
    }
    if (gainNode) {
        try { gainNode.disconnect(); } catch (e) {}
    }
    analyser = null;
    gainNode = null;
}

export function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

export function createMediaStreamDestination() {
    const ctx = getAudioContext();
    return ctx.createMediaStreamDestination();
}

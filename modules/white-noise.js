import { WHITE_NOISE_CANCEL_GAIN, SHUSH_MAX_RECORD_MS } from './config.js';
import { log, clamp, saveStoredState } from './utils.js';
import { elements } from './ui.js';

let whiteNoiseEnabled = false;
let whiteNoiseVolume = 0.5;
let whiteNoiseDurationMs = null;
let whiteNoiseStartedAt = null;
let whiteNoiseAutoplayBlocked = false;

let whiteNoiseSourceNode = null;
let whiteNoisePlaybackGain = null;
let whiteNoiseCancelGain = null;
let whiteNoiseStopTimeout = null;
let whiteNoiseUiInterval = null;

let shushClipDataUrl = null;
let shushUseCustom = false;
let shushRecording = false;
let shushRecorder = null;
let shushChunks = [];
let shushRecordStream = null;
let shushRecordTimeout = null;

let childShushClipDataUrl = null;
let childShushBuffer = null;
let childShushBufferKey = '';
let childShushSourceNode = null;
let whiteNoiseUsingCustomPlayback = false;

export function initWhiteNoise(role, roomId, audioCtx, transmitMixNode) {
    // This will be called from main.js
}

export function setWhiteNoiseState(next, role, roomId, audioCtx, transmitMixNode, broadcastToParents) {
    if (typeof next.enabled === 'boolean') whiteNoiseEnabled = next.enabled;
    if (typeof next.volume === 'number') whiteNoiseVolume = clamp(next.volume, 0, 1);
    if (Object.prototype.hasOwnProperty.call(next, 'durationMs')) whiteNoiseDurationMs = next.durationMs;
    if (typeof next.startedAt === 'number') whiteNoiseStartedAt = next.startedAt;

    if (!whiteNoiseEnabled) {
        whiteNoiseStartedAt = null;
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

    updateUI();
    
    if (role === 'child') {
        if (whiteNoiseEnabled) {
            startPlayback(audioCtx, transmitMixNode);
        } else {
            stopPlayback();
        }
    }
    
    updateGains(audioCtx, transmitMixNode);
    scheduleStop(role, broadcastToParents);
}

function updateUI() {
    if (elements.whiteNoiseToggle) {
        elements.whiteNoiseToggle.textContent = whiteNoiseEnabled ? 'Stop White Noise' : 'Start White Noise';
    }
    if (elements.whiteNoiseVolumeInput) {
        elements.whiteNoiseVolumeInput.value = Math.round(whiteNoiseVolume * 100).toString();
    }
    if (elements.whiteNoiseTimerSelect) {
        elements.whiteNoiseTimerSelect.value = whiteNoiseDurationMs === null ? 'infinite' : String(whiteNoiseDurationMs);
    }
}

function updateGains(audioCtx, transmitMixNode) {
    const volume = clamp(whiteNoiseVolume, 0, 1);
    if (whiteNoisePlaybackGain) {
        whiteNoisePlaybackGain.gain.value = volume;
    }
    if (whiteNoiseCancelGain) {
        whiteNoiseCancelGain.gain.value = whiteNoiseEnabled ? -volume * WHITE_NOISE_CANCEL_GAIN : 0;
    }
}

function startPlayback(audioCtx, transmitMixNode) {
    if (!elements.whiteNoiseAudio) return;
    
    ensureAudioGraph(audioCtx, transmitMixNode);
    
    const playAttempt = elements.whiteNoiseAudio.play();
    if (playAttempt && typeof playAttempt.then === 'function') {
        playAttempt.then(() => {
            whiteNoiseAutoplayBlocked = false;
            updateCta();
        }).catch(() => {
            whiteNoiseAutoplayBlocked = true;
            updateCta();
        });
    }
}

function stopPlayback() {
    if (!elements.whiteNoiseAudio) return;
    elements.whiteNoiseAudio.pause();
    elements.whiteNoiseAudio.currentTime = 0;
    whiteNoiseAutoplayBlocked = false;
    updateCta();
}

function ensureAudioGraph(audioCtx, transmitMixNode) {
    if (!audioCtx || !elements.whiteNoiseAudio) return;
    
    if (!whiteNoisePlaybackGain || !whiteNoiseCancelGain) {
        whiteNoisePlaybackGain = audioCtx.createGain();
        whiteNoiseCancelGain = audioCtx.createGain();
        whiteNoisePlaybackGain.connect(audioCtx.destination);
        if (transmitMixNode) {
            whiteNoiseCancelGain.connect(transmitMixNode);
        }
    }
    
    if (!whiteNoiseSourceNode) {
        whiteNoiseSourceNode = audioCtx.createMediaElementSource(elements.whiteNoiseAudio);
        whiteNoiseSourceNode.connect(whiteNoisePlaybackGain);
        whiteNoiseSourceNode.connect(whiteNoiseCancelGain);
    }
}

function updateCta() {
    if (elements.whiteNoiseCta) {
        elements.whiteNoiseCta.classList.toggle('hidden', !(whiteNoiseEnabled && whiteNoiseAutoplayBlocked));
    }
}

function scheduleStop(role, broadcastToParents) {
    if (whiteNoiseStopTimeout) clearTimeout(whiteNoiseStopTimeout);
    if (whiteNoiseUiInterval) clearInterval(whiteNoiseUiInterval);
    
    if (!whiteNoiseEnabled || whiteNoiseDurationMs === null) return;
    
    const elapsed = whiteNoiseStartedAt ? (Date.now() - whiteNoiseStartedAt) : 0;
    const remaining = whiteNoiseDurationMs - elapsed;
    
    if (remaining <= 0) {
        handleAutoStop(role, broadcastToParents);
        return;
    }
    
    whiteNoiseStopTimeout = setTimeout(() => handleAutoStop(role, broadcastToParents), remaining);
    whiteNoiseUiInterval = setInterval(updateStatus, 1000);
}

function handleAutoStop(role, broadcastToParents) {
    // Reset state and notify
}

function updateStatus() {
    // Update timer display
}

export function startShushRecording(roomId, onComplete) {
    // Implement recording logic
}

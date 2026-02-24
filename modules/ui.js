export const elements = typeof document !== 'undefined' ? {
    landingScreen: document.getElementById('landing-screen'),
    monitorScreen: document.getElementById('monitor-screen'),
    btnChild: document.getElementById('btn-child'),
    btnParent: document.getElementById('btn-parent'),
    btnConnect: document.getElementById('btn-connect'),
    roomIdInput: document.getElementById('room-id'),
    babyNameInput: document.getElementById('baby-name'),
    joinCodeActions: document.getElementById('join-code-actions'),
    btnCopyCode: document.getElementById('btn-copy-code'),
    btnNewCode: document.getElementById('btn-new-code'),
    roleDisplay: document.getElementById('role-display'),
    statusIndicator: document.getElementById('connection-status'),
    childControls: document.getElementById('child-controls'),
    parentControls: document.getElementById('parent-controls'),
    dimOverlay: document.getElementById('dim-overlay'),
    btnStop: document.getElementById('btn-stop'),
    btnListen: document.getElementById('btn-listen'),
    btnRetryMic: document.getElementById('btn-retry-mic'),
    btnResetParent: document.getElementById('btn-reset-parent'),
    audioStatus: document.getElementById('audio-status'),
    vadStatus: document.getElementById('vad-status'),
    wakeLockVideo: document.getElementById('wake-lock-video'),
    debugLog: document.getElementById('debug-log'),
    stateSummaryEl: document.getElementById('state-summary'),
    statusText: document.getElementById('status-text'),
    connectionMode: document.getElementById('connection-mode'),
    btnDimParent: document.getElementById('btn-dim-parent'),
    whiteNoiseToggle: document.getElementById('white-noise-toggle'),
    whiteNoiseVolumeInput: document.getElementById('white-noise-volume'),
    whiteNoiseTimerSelect: document.getElementById('white-noise-timer'),
    whiteNoiseAudio: document.getElementById('white-noise-audio'),
    whiteNoiseStatus: document.getElementById('white-noise-status'),
    whiteNoiseRemaining: document.getElementById('white-noise-remaining'),
    whiteNoiseCta: document.getElementById('white-noise-cta'),
    btnAckAlarm: document.getElementById('btn-ack-alarm'),
    btnRecordShush: document.getElementById('btn-record-shush'),
    btnToggleShush: document.getElementById('btn-toggle-shush'),
    btnClearShush: document.getElementById('btn-clear-shush'),
    shushStatus: document.getElementById('shush-status'),
} : {};

export function showScreen(screenId) {
    if (!elements.landingScreen || !elements.monitorScreen) {
        console.error('[UI] Missing screen elements: #landing-screen and/or #monitor-screen');
        return;
    }
    elements.landingScreen.classList.add('hidden');
    elements.monitorScreen.classList.add('hidden');
    if (screenId === 'landing') {
        elements.landingScreen.classList.remove('hidden');
    } else if (screenId === 'monitor') {
        elements.monitorScreen.classList.remove('hidden');
    }
}

export function updateConnectionStatus(state, text) {
    elements.statusIndicator.setAttribute('data-state', state);
    elements.statusText.textContent = text || state.charAt(0).toUpperCase() + state.slice(1);
}

export function toggleDim(force) {
    // If force is true, we want to SHOW the overlay (remove .hidden)
    // If force is false, we want to HIDE the overlay (add .hidden)
    const isVisible = force;
    elements.dimOverlay.classList.toggle('hidden', !isVisible);
    
    if (elements.btnDimParent) {
        elements.btnDimParent.textContent = isVisible ? 'Undim Screen' : 'Dim Screen';
    }
    return isVisible;
}

let visualizerActive = false;
let visualizerRafId = null;
let lastVisualizerPrefix = null;

export function visualize(prefix, analyser) {
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

export function stopVisualizer() {
    visualizerActive = false;
    if (visualizerRafId) cancelAnimationFrame(visualizerRafId);
    visualizerRafId = null;
    const allMeters = document.querySelectorAll('.meter-fill');
    allMeters.forEach(meter => {
        meter.style.width = '0%';
    });
}

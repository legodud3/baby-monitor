import { DATA_CHANNEL_ALARM_GRACE_MS } from './config.js';
import { log } from './utils.js';
import { elements } from './ui.js';

let alarmActive = false;
let alarmAudioCtx = null;
let alarmOscillator = null;
let alarmGainNode = null;
let alarmPulseInterval = null;
let alarmsEnabled = true;
let alarmGraceTimeout = null;

export function initAlarm() {
    elements.btnAckAlarm.addEventListener('click', acknowledgeAlarm);
}

export function stopAlarmTone() {
    if (alarmPulseInterval) {
        clearInterval(alarmPulseInterval);
        alarmPulseInterval = null;
    }
    if (alarmOscillator) {
        try { alarmOscillator.stop(); } catch (e) {}
        try { alarmOscillator.disconnect(); } catch (e) {}
        alarmOscillator = null;
    }
    if (alarmGainNode) {
        try { alarmGainNode.disconnect(); } catch (e) {}
        alarmGainNode = null;
    }
}

function ensureAlarmAudioContext() {
    if (!alarmAudioCtx) {
        alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (alarmAudioCtx.state === 'suspended') {
        alarmAudioCtx.resume();
    }
}

export function startAlarmTone() {
    if (!alarmsEnabled || alarmOscillator) return;
    ensureAlarmAudioContext();
    
    alarmOscillator = alarmAudioCtx.createOscillator();
    alarmGainNode = alarmAudioCtx.createGain();
    alarmOscillator.type = 'square';
    alarmOscillator.frequency.value = 880;
    alarmGainNode.gain.value = 0.0001;
    alarmOscillator.connect(alarmGainNode);
    alarmGainNode.connect(alarmAudioCtx.destination);
    alarmOscillator.start();
    
    let high = false;
    alarmPulseInterval = setInterval(() => {
        if (!alarmGainNode || !alarmAudioCtx) return;
        const now = alarmAudioCtx.currentTime;
        high = !high;
        alarmOscillator.frequency.setValueAtTime(high ? 980 : 720, now);
        alarmGainNode.gain.cancelScheduledValues(now);
        alarmGainNode.gain.setValueAtTime(high ? 0.45 : 0.08, now);
    }, 150);
}

export function triggerAlarm(reason) {
    if (alarmActive) return;
    log(`ALARM: ${reason}`, true);
    alarmActive = true;
    startAlarmTone();
    elements.btnAckAlarm.classList.remove('hidden');
    // Call setStatusText('alarm') via callback or exported function
}

export function acknowledgeAlarm() {
    alarmActive = false;
    stopAlarmTone();
    elements.btnAckAlarm.classList.add('hidden');
    log('Alarm acknowledged by user', false);
}

export function scheduleAlarm(reason) {
    if (alarmGraceTimeout) return;
    alarmGraceTimeout = setTimeout(() => {
        alarmGraceTimeout = null;
        triggerAlarm(reason);
    }, DATA_CHANNEL_ALARM_GRACE_MS);
}

export function clearAlarmGrace() {
    if (alarmGraceTimeout) {
        clearTimeout(alarmGraceTimeout);
        alarmGraceTimeout = null;
    }
}

export function isAlarmActive() { return alarmActive; }
export function setAlarmsEnabled(val) { alarmsEnabled = val; }

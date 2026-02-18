// DOM Elements
const landingScreen = document.getElementById('landing-screen');
const monitorScreen = document.getElementById('monitor-screen');
const btnChild = document.getElementById('btn-child');
const btnParent = document.getElementById('btn-parent');
const roomIdInput = document.getElementById('room-id');
const roleDisplay = document.getElementById('role-display');
const statusIndicator = document.getElementById('connection-status');
const childControls = document.getElementById('child-controls');
const parentControls = document.getElementById('parent-controls');
const btnDim = document.getElementById('btn-dim');
const dimOverlay = document.getElementById('dim-overlay');
const btnStop = document.getElementById('btn-stop');
const audioVisualizer = document.getElementById('audio-visualizer');
const btnListen = document.getElementById('btn-listen');
const volumeControl = document.getElementById('volume-control');
const volumeValueDisplay = document.getElementById('volume-value');
const dbMeterFill = document.getElementById('db-level');
const audioStatus = document.getElementById('audio-status');
const vadStatus = document.getElementById('vad-status');
const vadSensitivity = document.getElementById('vad-sensitivity');
const vadValueDisplay = document.getElementById('vad-value');
const wakeLockVideo = document.getElementById('wake-lock-video');
const debugLog = document.getElementById('debug-log');

// State
let role = null;
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

// Constants
const PEER_CONFIG = {
    debug: 2,
    secure: true
};
const VAD_HOLD_TIME = 2000; // ms to keep mic open after noise stops

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
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}

// Event Listeners
btnChild.addEventListener('click', () => startSession('child'));
btnParent.addEventListener('click', () => startSession('parent'));
btnDim.addEventListener('click', toggleDim);
// Double-tap logic for dim overlay
let lastTap = 0;
dimOverlay.addEventListener('click', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 500 && tapLength > 0) {
        toggleDim();
        e.preventDefault();
    }
    lastTap = currentTime;
});
btnStop.addEventListener('click', stopSession);
btnListen.addEventListener('click', resumeAudioContext);
if(vadSensitivity) {
    vadSensitivity.addEventListener('input', updateSensitivityLabel);
}
if(volumeControl) {
    volumeControl.addEventListener('input', updateVolumeLabel);
}

// Initialization
async function startSession(selectedRole) {
    try {
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
        
        if (role === 'child') {
            initChild();
        } else {
            initParent();
        }

        requestWakeLock();
    } catch (e) {
        console.error(e);
        log(`App Error: ${e.message}`, true);
    }
}

function switchToMonitor() {
    landingScreen.classList.add('hidden');
    monitorScreen.classList.remove('hidden');
    roleDisplay.textContent = role === 'child' ? 'Child Unit (Sender)' : 'Parent Unit (Receiver)';
    if (role === 'child') {
        childControls.classList.remove('hidden');
    } else {
        parentControls.classList.remove('hidden');
    }
}

function stopSession() {
    if (peer) peer.destroy();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (wakeLock) wakeLock.release();
    if (reconnectInterval) clearInterval(reconnectInterval);
    if (vadInterval) clearInterval(vadInterval);
    if (audioCtx) audioCtx.close();
    
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

function toggleDim() {
    dimOverlay.classList.toggle('hidden');
    if (!dimOverlay.classList.contains('hidden')) {
        dimOverlay.innerHTML = '<p>Double-tap to wake</p>';
    }
}

function updateSensitivityLabel() {
    const val = vadSensitivity.value;
    let label = 'Medium';
    if (val < 30) label = 'Low (Hears only loud noises)';
    else if (val > 70) label = 'High (Hears everything)';
    else label = 'Medium';
    vadValueDisplay.textContent = label;
}

function updateVolumeLabel() {
    const val = volumeControl.value;
    volumeValueDisplay.textContent = `${val}%`;
    if (gainNode) {
        gainNode.gain.setTargetAtTime(val / 100, audioCtx.currentTime, 0.05);
    }
}

// PeerJS & Logic
function getPeerId(r) {
    return `babymonitor-${roomId}-${r}`;
}

// --- CHILD LOGIC ---
let childRetryInterval = null;

function initChild() {
    const myId = `babymonitor-${roomId}-child`;
    log(`Creating Peer: ${myId}...`);
    
    if (peer) peer.destroy();
    peer = new Peer(myId, PEER_CONFIG);

    peer.on('open', (id) => {
        log('Peer Open. ID: ' + id, false);
        switchToMonitor();
        updateStatus(true); // Connected to signaling server
        startStreaming();
    });

    peer.on('error', (err) => {
        console.error('Peer Error:', err.type, err);
        if (err.type === 'unavailable-id') {
            log(`ID '${roomId}' taken.`, true);
            alert('Room Name Taken. Please choose another.');
            stopSession();
        } else if (err.type === 'peer-unavailable') {
            // Target not found, retry
            log('Parent not found. Retrying...', false);
            retryConnection();
        } else if (err.type === 'network') {
            log('Network Error.', true);
        } else {
            log(`Peer Error: ${err.type}`, true);
            updateStatus(false);
            // General error, retry initialization
            setTimeout(initChild, 5000);
        }
    });

    peer.on('disconnected', () => {
        log('Disconnected from Server. Reconnecting...', true);
        updateStatus(false);
        peer.reconnect();
    });
}

async function startStreaming() {
    try {
        if (!localStream) {
            log("Requesting Mic...", false);
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            log(`Mic Active. Tracks: ${localStream.getTracks().length}`, false);
        }
        
        setupVAD(localStream);
        connectToParent();
        
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
    const vadTrack = stream.getAudioTracks()[0].clone();
    const vadStream = new MediaStream([vadTrack]);
    const source = audioCtx.createMediaStreamSource(vadStream);
    
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Start loop
    if (vadInterval) clearInterval(vadInterval);
    
    let logCounter = 0;
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
        
        const sliderVal = parseInt(vadSensitivity.value);
        // Map 0-100 to 60-5 (High sens = low threshold)
        const threshold = 60 - (sliderVal * 0.55); 
        
        const now = Date.now();
        const audioTrack = stream.getAudioTracks()[0]; // The transmission track
        
        // Log every 5 seconds
        logCounter++;
        if (logCounter % 50 === 0) {
            console.log(`VAD: RMS=${rms.toFixed(1)}, Threshold=${threshold.toFixed(1)}, Active=${isTransmitting}`);
        }

        if (rms > threshold) {
            lastNoiseTime = now;
            if (!isTransmitting) {
                isTransmitting = true;
                if (audioTrack) audioTrack.enabled = true;
                vadStatus.textContent = "Transmitting (Noise Detected)";
                vadStatus.style.color = "#ff5252";
                log("VAD: Noise detected, resuming transmission");
            }
        } else {
            if (isTransmitting && (now - lastNoiseTime > VAD_HOLD_TIME)) {
                isTransmitting = false;
                if (audioTrack) audioTrack.enabled = false;
                vadStatus.textContent = "Monitoring (Silence - Saving Data)";
                vadStatus.style.color = "#69f0ae";
                log("VAD: Silence detected, pausing transmission");
            }
        }
        
    }, 100); // Check every 100ms
}

function connectToParent() {
    if (currentCall) {
        currentCall.close();
    }

    const targetId = `babymonitor-${roomId}-parent`;
    log(`Calling Parent (${targetId})...`, false);
    
    const call = peer.call(targetId, localStream);
    currentCall = call;

    call.on('close', () => {
        log('Call lost/closed. Retrying...', true);
        retryConnection();
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        log(`Call Error: ${err.type}`, true);
        retryConnection();
    });
}

function retryConnection() {
    if (childRetryInterval) return; // Already retrying
    
    childRetryInterval = setTimeout(() => {
        childRetryInterval = null;
        connectToParent();
    }, 3000);
}

// --- PARENT LOGIC ---
function initParent() {
    const myId = `babymonitor-${roomId}-parent`;
    log(`Creating Peer: ${myId}...`);
    
    if (peer) peer.destroy();
    peer = new Peer(myId, PEER_CONFIG);

    peer.on('open', (id) => {
        log('Peer Open. Waiting for Child...', false);
        switchToMonitor();
        updateStatus(true); 
        audioStatus.textContent = "Waiting for Child unit...";
    });

    peer.on('call', (call) => {
        log(`Incoming Call from ${call.peer}`, false);
        call.answer(); 
        handleIncomingCall(call);
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
        }
    });
    
    peer.on('disconnected', () => {
         log('Disconnected. Reconnecting...', true);
         peer.reconnect();
    });
}

function handleIncomingCall(call) {
    if (currentCall) {
        currentCall.close();
    }
    currentCall = call;
    
    call.on('stream', (remoteStream) => {
        console.log('Stream received');
        playAudio(remoteStream);
        updateStatus(true, 'active'); // Active connection
        audioStatus.textContent = "Audio Connected";
        statusIndicator.style.backgroundColor = '#69f0ae'; // Bright Green
    });

    call.on('close', () => {
        console.log('Call closed');
        updateStatus(true); // Still connected to server, just lost call
        audioStatus.textContent = "Signal Lost. Waiting for Child...";
        stopVisualizer();
        statusIndicator.style.backgroundColor = '#ffcc00'; // Yellow/Orange for waiting
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
    });
}

// Audio Handling
function playAudio(stream) {
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(err => {
            console.warn('Auto-play blocked, waiting for user interaction:', err);
            btnListen.style.display = 'block';
            audioStatus.textContent = "Tap 'Start Listening' to hear audio";
        });
    }

    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    
    // Setup Analyser
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256; // Better resolution for DB meter
    
    // Setup Gain Node for amplification
    gainNode = audioCtx.createGain();
    const initialVolume = volumeControl ? parseInt(volumeControl.value) : 100;
    gainNode.gain.setValueAtTime(initialVolume / 100, audioCtx.currentTime);
    
    // Routing: source -> analyser -> gainNode -> destination
    // This way analyser shows input level even if gain is low
    source.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    visualize();

    if (audioCtx.state === 'suspended') {
        audioStatus.textContent = "Tap 'Start Listening' to hear audio";
        btnListen.style.display = 'block';
    } else {
        if (remoteAudio && !remoteAudio.paused) {
            btnListen.style.display = 'none';
        }
    }
}

function resumeAudioContext() {
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
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
}

// Visualizer
function visualize() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const bars = document.querySelectorAll('.bar');

    function draw() {
        if (!analyser) return;
        
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        // Calculate Average for DB Meter
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Map average to percentage (0-255 -> 0-100%)
        // Let's use a non-linear mapping for better "decibel meter" feel
        // 0-255 range. Speaking is usually around 100-150.
        const levelPercent = Math.min(100, (average / 150) * 100);
        if (dbMeterFill) {
            dbMeterFill.style.width = `${levelPercent}%`;
            
            // Color feedback on meter
            if (levelPercent > 85) dbMeterFill.style.backgroundColor = '#ff5252';
            else if (levelPercent > 60) dbMeterFill.style.backgroundColor = '#ffcc00';
            else dbMeterFill.style.backgroundColor = '#69f0ae';
        }

        // Small bar visualizer
        for (let i = 0; i < bars.length; i++) {
            // Sample a range of frequencies
            const startIdx = Math.floor(i * (bufferLength / bars.length));
            let maxVal = 0;
            for(let j=0; j < (bufferLength/bars.length); j++) {
                if(dataArray[startIdx + j] > maxVal) maxVal = dataArray[startIdx + j];
            }
            
            const height = Math.max(5, (maxVal / 255) * 100);
            bars[i].style.height = `${height}%`;
            
            if (maxVal > 200) {
                bars[i].style.backgroundColor = '#ff5252';
            } else {
                bars[i].style.backgroundColor = '#64ffda';
            }
        }
    }
    draw();
}

function stopVisualizer() {
    const bars = document.querySelectorAll('.bar');
    bars.forEach(bar => {
        bar.style.height = '5px';
        bar.style.backgroundColor = '#64ffda';
    });
    if (dbMeterFill) {
        dbMeterFill.style.width = '0%';
    }
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
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
    
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Start loop
    if (vadInterval) clearInterval(vadInterval);
    
    vadInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate RMS (volume)
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        
        // Threshold calculation: 0-100 slider -> 0-255 range (inverted logic)
        // High sensitivity (100) -> Low threshold (e.g., 5)
        // Low sensitivity (0) -> High threshold (e.g., 50)
        // Let's say max practical noise floor is ~50 in a quiet room, speaking is ~100+
        
        const sliderVal = parseInt(vadSensitivity.value);
        // Map 0-100 to 60-5 (High sens = low threshold)
        const threshold = 60 - (sliderVal * 0.55); 
        
        const now = Date.now();
        const audioTrack = stream.getAudioTracks()[0];
        
        if (rms > threshold) {
            lastNoiseTime = now;
            if (!isTransmitting) {
                isTransmitting = true;
                audioTrack.enabled = true;
                vadStatus.textContent = "Transmitting (Noise Detected)";
                vadStatus.style.color = "#ff5252";
            }
        } else {
            if (isTransmitting && (now - lastNoiseTime > VAD_HOLD_TIME)) {
                isTransmitting = false;
                audioTrack.enabled = false;
                vadStatus.textContent = "Monitoring (Silence - Saving Data)";
                vadStatus.style.color = "#69f0ae";
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
    // We need a user gesture to play audio usually, handled by "Start Listening" button if needed
    // But we'll try to auto-play and if it fails, show the button
    
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 32;
    
    source.connect(analyser);
    // Determine if we need to connect to destination (speakers)
    // If we only analyze, we don't hear it. We MUST connect to destination.
    // However, connecting source->destination directly works, but we also want the analyser.
    // source -> analyser -> destination
    analyser.connect(audioCtx.destination);

    visualize();

    if (audioCtx.state === 'suspended') {
        audioStatus.textContent = "Tap 'Start Listening' to hear audio";
        btnListen.style.display = 'block';
    } else {
        btnListen.style.display = 'none';
    }
}

function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            btnListen.style.display = 'none';
            audioStatus.textContent = "Audio Connected";
        });
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

        // Simple visualizer: map a few frequency bands to bars
        // We have 5 bars. 
        // Let's just take an average or specific indices.
        // fftSize 32 -> 16 bins.
        
        for (let i = 0; i < 5; i++) {
            const val = dataArray[i * 2]; // simple sampling
            const height = Math.max(5, (val / 255) * 100);
            bars[i].style.height = `${height}%`;
            
            // Color indication for loudness
            if (val > 200) {
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
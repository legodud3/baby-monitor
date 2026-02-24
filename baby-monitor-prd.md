PRD: KGBaby v0.1 (Audio Monitor)
Objective: A browser-based audio monitor that allows one device (Child) to stream audio to another (Parent) with low latency.

1. Core Functionality
The app functions as a peer-to-peer (P2P) bridge, with relay support for restrictive networks. There are two primary modes of operation.

A. The Child Mode (The "Sender")
Automatic Start: Once selected, the mic initializes immediately.
Acoustic Settings: Uses specific WebRTC constraints to optimize for a baby's room:
echoCancellation: false (Not needed since the child phone isn't playing audio; disabling this improves clarity).
noiseSuppression: true (To filter out white noise machines or fans).
autoGainControl: true (Ensures that even a faint whimper is amplified).
Link Status: A persistent "Recording" indicator (standard in browsers) and an on-screen "Mic Active" status.
B. The Parent Mode (The "Listener")
Auto-Play Loophole: Requires a "Start Listening" button click to satisfy browser security policies for audio playback.
Visual Audio Meter: A CSS-based volume bar that moves even if the parent has their phone volume low. This provides visual confirmation that "the link is alive."
Always-On Audio: Uses the HTML5 Audio API with a persistent stream.
2. Technical Milestones
Phase 1: Signaling & Handshake (PeerJS)
Room ID Logic: Users enter a "Room Name" (e.g., AB802). Both devices use this string to find each other on the PeerJS cloud server.
Role Assignment: The URL will append ?role=child or ?role=parent.
Phase 2: Power Management (The "Deep Sleep" Fix)
Screen Wake Lock API: Implements navigator.wakeLock to prevent the "Child" phone from turning off the screen and killing the mic process.
Battery Optimization: Includes a "Dim Screen" overlay (a black div with 90% opacity) to save battery on OLED screens while keeping the browser active.
Phase 3: Reliability & Reconnection
Connection Heartbeat: If the Wi-Fi blips, the Parent device detects the on('close') event and attempts to auto-reconnect every 5 seconds.
Connection Status: A simple Red/Green dot indicating if the P2P link is active.
3. Quality & Reliability
Phase 1: Automated Relay Diagnostics
The app automatically identifies the ICE connection path (Direct vs Relay).
The Parent Unit displays the current connection mode in real-time, providing transparency about data usage and privacy.
Phase 2: Error Recovery
Interactive recovery controls ("Retry Mic" and "Reset Connection") allow users to recover from transient failures without a full page reload.
Comprehensive logging of the signal path and media stats provides immediate feedback on connection health.
Phase 3: Battery Optimization
Automatic throttling of high-CPU UI tasks (like the audio visualizer) when the screen is dimmed to maximize overnight battery life.

4. UI/UX Design (Mobile First)
The interface should be high-contrast and easy to use in a dark room.
Dark Mode Default: Deep blacks and soft greens to avoid "blue light" wakefulness.
Big Buttons: Touch targets for "Start" and "Stop" must be large.
Volume Visualizer: A simple vertical bar that turns orange/red when the baby's room exceeds a certain decibel threshold.
5. Technical Constraints
Security: Must be hosted on HTTPS (GitHub Pages is fine).
Network: Best performance on the same Wi-Fi. If using 5G to Wi-Fi, PeerJS will automatically try to negotiate a STUN connection.
Browser: Optimized for iOS Safari and Android Chrome.
6. Success Metrics
Latency: Audio delay should be <100ms.
Stability: Must maintain a continuous stream for ≥8 hours (overnight).

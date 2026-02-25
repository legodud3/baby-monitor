PRD: KGBaby v0.4.2 (Audio Monitor)
Objective: A browser-based audio monitor that allows one device (Child) to stream audio to one or more Parent devices with low latency and robust fallback behavior on restrictive networks.

1. Core Functionality
The app operates as a WebRTC system with direct-path preference and relay fallback.

A. Child Mode (Sender)
- Automatic start: after role selection and connect, the app requests mic access and prepares transmit chain.
- Acoustic settings:
  - `echoCancellation: false`
  - `noiseSuppression: true`
  - `autoGainControl: true`
- Activity model:
  - rolling noise floor
  - elevated event detection
  - infant states: `zzz`, `settled`, `stirring`, `needsCare`
- Control channel: receives parent commands (for example, dim-screen sync).

B. Parent Mode (Listener)
- Start listening action: required to satisfy browser autoplay policy.
- Live monitor:
  - receives remote audio stream
  - visual meter for confidence that stream is active
- Comfort controls:
  - white-noise control
  - dim child screen
  - shush recording/toggle

2. Signaling and Session Model
- PeerJS is used for signaling and peer session setup.
- User flow uses role buttons + join code entry, not URL role query params.
- Session IDs are derived from normalized join codes.
- Multiple parents can join a single child session.

3. Connectivity Strategy
- Preferred path: direct ICE candidates (`host` / `srflx`) for best latency/privacy.
- Fallback path: TURN relay candidates (`relay`) when direct path fails.
- Parent UI exposes current mode (`Direct` vs `Relay`) from ICE candidate type.
- TURN servers are configured at runtime via `window.TURN_CONFIG` (for example, in `secrets.js`).

4. Reliability and Recovery
- Parent retry loop uses progressive backoff (starting at 3s up to 30s).
- Data channel has open-timeout handling and autonomous reconnect attempts.
- Heartbeat watchdog is media-aware:
  - suppresses false alarms when media remains healthy
  - triggers alarm when heartbeat is stale and media is unhealthy.
- Recovery controls:
  - `Retry Mic` (child)
  - `Reset Connection` (parent)

5. Power and Session Longevity
- Wake Lock API is used when available.
- Hidden looping video fallback helps keep session active on mobile browsers.
- Dim overlay is available to reduce light disturbance.

6. Security and Privacy Constraints
- App must be hosted on HTTPS.
- Direct mode is preferred for privacy and latency.
- TURN relay is a reliability fallback and not the privacy-preferred mode because traffic transits third-party relay infrastructure.

7. Browser and Network Constraints
- Optimized for iOS Safari and Android Chrome.
- Works best on same-network/home mesh setups in direct mode.
- Guest Wi-Fi, carrier NAT, or restrictive firewalls may require TURN relay.

8. Success Criteria
- Connection success rate improves on restrictive networks with TURN fallback.
- Parent can maintain monitor session across transient data-channel failures.
- False disconnect alarms are reduced by media-aware watchdog gating.
- End-to-end usability remains simple for non-technical users (role select, join code, connect, listen).

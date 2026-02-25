# Tech Choices and Design Rationale (KGBaby v0.4)

This document explains the technical and UX decisions in the current release.

## Core Architecture

- **WebRTC via PeerJS (Direct-First + TURN Fallback)**
  - Why: Direct ICE path gives lowest latency and strongest privacy posture on friendly networks.
  - Tradeoff: Restrictive NAT/guest/cellular networks often require TURN relay for reliability.
  - Operational nuance: Relay mode is fallback, not preference.

- **Native ES Modules (No-Build)**
  - Why: Maintains "no-build" portability while resolving monolithic file complexity.
  - Benefit: Clear domain separation between UI, Audio, and Networking logic without needing Webpack or Vite.
  - Tradeoff: Requires a local server (like `npx serve`) during development to satisfy CORS/ESM requirements.

- **Browser-first**
  - Why: Faster setup on spare phones and tablets.
  - Tradeoff: Mobile autoplay/background constraints are stricter than native apps.

## Audio and Detection

- **Always-on transmission**
  - Why: Avoids missing quieter sounds that gate-based streaming can drop.
  - Tradeoff: Higher continuous CPU/network usage.

- **Room-optimized mic constraints** (`echoCancellation: false`, `noiseSuppression: true`, `autoGainControl: true`)
  - Why: Better real-room pickup quality for nursery environments.
  - Tradeoff: Slight coloration versus raw microphone fidelity.

- **Fixed mic gain boost (3.0x)**
  - Why: Simpler control surface for nighttime usage and reliable alert audibility.
  - Tradeoff: Potential distortion under very loud input.

- **VAD-based elevated activity + infant states**
  - Why: Parents get neutral state summaries instead of alarm-centric wording.
  - How: Rolling noise floor drives two signals: elevated event recency and state transitions (`zzz`, `settled`, `stirring`, `needsCare`).
  - Tradeoff: State is heuristic and may vary with room acoustics.

## White Noise Design

- **Child-only playback with parent-stream suppression**
  - Why: Keep soothing noise in-room while preserving parent monitoring clarity.
  - How: White-noise track is injected into playback while an inverse gain is mixed into outbound stream.
  - Tradeoff: Cancellation is best effort and acoustics dependent.

- **Simple timer model (30 / 60 / infinite)**
  - Why: Covers common routines with minimal cognitive load.

- **Autoplay fallback CTA on child**
  - Why: Handles mobile browser media-gesture restrictions.

## Power and Reliability

- **Wake Lock API + hidden video fallback**
  - Why: Reduces risk of child device sleeping and stopping capture.
  - Tradeoff: Not uniformly supported across browsers.

- **Screen dim overlay**
  - Why: Lowers light disturbance and helps OLED battery use.

- **Auto reconnect flow**
  - Why: Recovers from transient Wi-Fi drops without manual full reset.

- **Media-aware alarm watchdog**
  - Why: Avoids false disconnect alarms when media is still healthy but heartbeat/data channel is delayed.
  - Tradeoff: Adds more state tracking and telemetry complexity.

- **Data-channel open timeout and recovery**
  - Why: Recreate stalled control channels without tearing down active media.
  - Tradeoff: More reconnection logic and diagnostics.

## UI and Interaction

- **State-forward redesign**
  - Why: Nighttime monitoring benefits from calmer wording and clearer visual hierarchy.
  - What changed: card-based layout, stronger status rail, improved button hierarchy, responsive spacing, and state chip styling.

- **Parent-first control grouping**
  - Why: White-noise, dim, and listen actions are clustered around the activity meter to reduce navigation effort.

## Known Constraints

- **Mobile background suspension** can still pause mic/WebRTC despite wake-lock attempts.
- **TURN infrastructure** is external to this repository and introduces relay-path privacy tradeoffs versus direct mode.
- **State confidence** depends on device mic quality, placement, and ambient noise profile.

# Tech Choices and Design Rationale (KGBaby v0.2)

This document explains the technical and UX decisions in the current release.

## Core Architecture

- **WebRTC via PeerJS (P2P)**
  - Why: Keeps audio path direct for low latency and privacy.
  - Tradeoff: Some networks still require TURN fallback.

- **Browser-first, no build step**
  - Why: Faster setup on spare phones and tablets.
  - Tradeoff: Mobile autoplay/background constraints are stricter than native apps.

## Audio and Detection

- **Always-on transmission**
  - Why: Avoids missing quieter sounds that gate-based streaming can drop.
  - Tradeoff: Higher continuous CPU/network usage.

- **Room-optimized mic constraints** (`echoCancellation`, `noiseSuppression`, `autoGainControl`)
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

## UI and Interaction

- **State-forward redesign**
  - Why: Nighttime monitoring benefits from calmer wording and clearer visual hierarchy.
  - What changed: card-based layout, stronger status rail, improved button hierarchy, responsive spacing, and state chip styling.

- **Parent-first control grouping**
  - Why: White-noise, dim, and listen actions are clustered around the activity meter to reduce navigation effort.

## Known Constraints

- **Mobile background suspension** can still pause mic/WebRTC despite wake-lock attempts.
- **TURN infrastructure** is optional and external to this repository.
- **State confidence** depends on device mic quality, placement, and ambient noise profile.

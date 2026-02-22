# KGBaby v0.3 - Private Browser Baby Monitor

A secure, low-latency audio monitor that runs in the browser using direct WebRTC (PeerJS) connections.

## Features

- **Direct P2P Audio**: Child-to-parent streaming without routing live audio through an app server.
- **State-First Monitoring**: Parent view shows calm baby-state labels (`😴 Zzz`, `🙂 Settled`, `😣 Stirring`, `🚨 Needs attention`) plus `Last elevated ...` timing.
- **Redesigned Mobile UI**: Card-based controls, stronger status visibility, and improved readability in low-light rooms.
- **Parent Controls**: Trigger child white noise, set timer (30/60/infinite), adjust volume, and dim/wake child screen.
- **Join-Code Pairing**: Pair devices with a non-identifying join code (example: `OTTER-AB12-CD34`).
- **Multiple Parents**: More than one parent device can join with the same join code.
- **Fail-Safe Alarm Skeleton**: Parent supports heartbeat watchdog checks with an alarm acknowledgment flow.
- **Local Persistence**: White-noise and infant-state context are stored per join code in local browser storage.
- **Reliability Guards**: Auto-reconnect handling, wake-lock support, and debug overlay (`?debug=1`).

## Quick Start

1. Open the app on two devices.
2. Choose `Child Unit` on the nursery device and `Parent Unit` on the listening device.
3. On child, the app auto-generates a join code. Tap `Copy Code` and share it to parent.
4. Enter that same join code on parent.
5. (Optional) Set a baby name label on each device for friendly UI text.
6. Tap `Connect`.
7. On parent, tap `Start Listening` if autoplay is blocked.

## Recommended Setup

- Keep the child device 1-3 ft from the crib with the mic unobstructed.
- Keep child device plugged in for long sessions.
- Keep app in foreground (mobile browsers may suspend capture in background).
- Use same Wi-Fi when possible for best peer connectivity.

## Tuning Activity Detection

Edit `cry-config.js`:

```js
window.CRY_CONFIG = {
  sustainedSeconds: 1.5,
  minDbAboveNoise: 12,
  cooldownSeconds: 10,
  noiseFloorWindowSeconds: 8,
  noiseFloorUpdateMarginDb: 3,
  needsCareSustainedSeconds: 120,
  nonCriticalStateMinHoldSeconds: 60
};
```

Notes:
- `minDbAboveNoise` controls loudness sensitivity for elevated events.
- `needsCareSustainedSeconds` controls how long loud audio must continue before `Needs attention`.
- `nonCriticalStateMinHoldSeconds` controls how often non-critical states can change.
- Elevated events feed parent recency text and influence state transitions.

## Optional Network Tuning

Edit `network-config.js` for lower-bandwidth environments:

```js
window.NETWORK_CONFIG = {
  lowBandwidth: true,
  bitrateLevelsKbps: [32, 48, 64],
  lowBandwidthLevelsKbps: [12, 24, 48]
};
```

## Optional TURN

If direct peer connection fails on restrictive networks:

```html
<script>
  window.TURN_CONFIG = {
    urls: "turn:your.turn.server:3478",
    username: "user",
    credential: "pass"
  };
</script>
```

## Troubleshooting

- **No audio**: Tap `Start Listening` on parent (autoplay policy).
- **White noise not playing**: On child, tap `Tap to enable white noise`.
- **Quiet output**: Raise device volume on parent.
- **Unstable connection**: Refresh both devices and rejoin with the same join code.
- **Echo**: Keep parent device out of the nursery.
- **PeerJS failed to load**: App loads `vendor/peerjs.min.js` first, then falls back to `unpkg.com`. If both fail, check captive portal, VPN, DNS, and firewall.
- **Build mismatch across devices**: Compare the `Build ...` suffix in the status line on both devices. If different, fully close/reopen tabs and hard refresh.

## Development

The project uses a **native ES Module (No-Build)** architecture. This means you don't need `npm install` or a build step to run it. Simply serve the files locally:

```bash
# Example using npx
npx serve
```

### PeerJS Source of Truth

- Runtime loads PeerJS from `vendor/peerjs.min.js` first, with CDN fallback to `https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js`.
- Dependency is pinned as `peerjs@1.5.2` in `package.json` for provenance/version tracking.

### Build Fingerprint and Release Verification

- Build ID source of truth: `APP_BUILD_ID` in `modules/config.js`.
- App logs build info on startup: `[BUILD] id=... stage=... url=...`.
- Status line includes `Build ...` to compare parent/child quickly.

```bash
# Verify the deployed app bundle exposes build logging in main.js
curl -fsSL https://legodud3.github.io/kgbaby/main.js | rg "\\[BUILD\\]"

# Verify the deployed build fingerprint value
curl -fsSL https://legodud3.github.io/kgbaby/modules/config.js | rg "APP_BUILD_ID|2026-02-22.1"
```

### Architecture
- `main.js`: Entry point that orchestrates role selection and application lifecycle.
- `modules/`:
  - `audio.js`: Encapsulates Web Audio API, VAD engine, and transmission chain.
  - `network.js`: Manages PeerJS lifecycle, heartbeats, and bitrate adaptation.
  - `ui.js`: DOM selections and visual state updates.
  - `config.js`: Centralized technical constants and parameters.
  - `utils.js`: Pure functional helpers and storage management.
  - `alarm.js`: Isolated fail-safe alarm logic.

## License

MIT (`LICENSE`).

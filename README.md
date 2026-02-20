# KGBaby v0.2 - Private Browser Baby Monitor

A secure, low-latency audio monitor that runs in the browser using direct WebRTC (PeerJS) connections.

## Features

- **Direct P2P Audio**: Child-to-parent streaming without routing live audio through an app server.
- **State-First Monitoring**: Parent view shows calm infant state labels (`Zzz`, `Settled`, `Stirring`, `Needs attention`) plus recent elevated-activity timing.
- **Redesigned Mobile UI**: Card-based controls, stronger status visibility, and improved readability in low-light rooms.
- **Parent Controls**: Trigger child white noise, set timer (30/60/infinite), adjust volume, and dim/wake child screen.
- **Multiple Parents**: More than one parent device can join the same room.
- **Local Persistence**: White-noise and infant-state context are stored per room in local browser storage.
- **Reliability Guards**: Auto-reconnect handling, wake-lock support, and debug overlay (`?debug=1`).

## Quick Start

1. Open the app on two devices.
2. Choose `Child Unit` on the nursery device and `Parent Unit` on the listening device.
3. Enter the same room name on both devices.
4. Tap `Connect`.
5. On parent, tap `Start Listening` if autoplay is blocked.

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
  noiseFloorUpdateMarginDb: 3
};
```

Notes:
- `minDbAboveNoise` and `sustainedSeconds` are the primary sensitivity controls.
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
- **Unstable connection**: Refresh both devices and rejoin with same room name.
- **Echo**: Keep parent device out of the nursery.

## Development

No build step required.

```bash
npx serve
```

## License

MIT (`LICENSE`).

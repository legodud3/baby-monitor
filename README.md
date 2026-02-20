# KGBaby v0.1 - Private Browser-Based Baby Monitor

A secure, zero-latency audio monitor that works over your local network using WebRTC (PeerJS). Designed for travel or backup use.

## Features

- **Zero Latency**: Direct Peer-to-Peer (P2P) audio streaming.
- **Privacy First**: Audio never touches a cloud server (except for the initial handshake).
- **Dark Mode**: OLED-friendly interface for use in dark rooms.
- **Smart Audio**:
    - **Child Unit**: Noise suppression and auto-gain (hears whispers, ignores fans).
    - **Parent Unit**: Visual audio meter to see noise even when muted.
- **Parent-Only Controls**: Mode (Transparency/Minimal), Mic Boost, and Dim Child Screen.
- **Last Cry Indicator**: Parent shows “Last cry” based on sustained noise detection (This feature is WIP).
- **Multiple Parents**: More than one parent device can connect to the same child (same room name).
- **Local Settings**: Mode, mic boost, and last cry persist per room on each device.
- **Loud Alert Output**: Parent audio is amplified for alerting (fidelity tradeoff).
- **Reliability**: Auto-reconnection if Wi-Fi drops.

## How to Use

1. **Open the App**: 
   - Open legodud3.github.io/kgbaby on both the child & parent device browsers
   - You may also host it yourself on GitHub Pages by cloning the repo or open `index.html` locally.
   - **HTTPS is required** for microphone access (unless on `localhost`).

2. **Select Role**:
   - **Device 1 (Baby's Room)**: Select **Child Unit**.
   - **Device 2 (Parent)**: Select **Parent Unit**.

3. **Enter Room Name**:
   - Enter the **same** unique room name on both devices (e.g., `cabin123`).

4. **Start Monitoring**:
   - Tap **Connect** on both devices.
   - **Child Unit**: Allow microphone access.
   - **Parent Unit**: Wait for the status to show **Connected**. 
   - If audio doesn't play automatically, tap "Start Listening".
   - Use parent controls to switch **Transparency/Minimal**, toggle **Mic Boost**, or **Dim Child Screen**.

## Multiple Parents

- Use the same room name on each parent device.
- The child unit is the host; each parent connects independently.
- All parents can change settings; the last change wins.
- More parents increases upload bandwidth/CPU load on the child device.

## Setup Guide (Text-Only)

Use this section as your basic setup checklist (screenshots/video can be added here later).

1. **Place the Child Device**
   - Put it 1–3 ft from the baby with the microphone unobstructed.
   - Avoid placing it behind pillows, blankets, or inside cribs where sound is muffled.

2. **Keep the App in the Foreground**
   - On iOS, use **Guided Access** to prevent switching away.
   - On Android, keep the screen on or use the built-in **Dim Child Screen**.

3. **Pick the Right Mode**
   - **Transparency**: always transmits (best for alerts).
   - **Minimal**: transmits only on sustained noise above the adaptive threshold.

4. **Boost When Needed**
   - If the parent audio is too quiet, enable **Mic Boost** and raise device volume.

## Recommended Setup

- **Distance**: Keep the child device close (1–3 ft) to avoid missing quiet sounds.
- **Power**: Plug in the child device for overnight use.
- **Audio Capture**: If the phone mic is too weak at distance, use an external mic (USB‑C/Lightning lavalier or clip‑on).
- **Network**: Same Wi‑Fi is ideal; avoid client‑isolated guest networks.

## Tuning Cry Detection

Adjust cry sensitivity in `cry-config.js`:

```js
window.CRY_CONFIG = {
  sustainedSeconds: 1.5,        // How long sound must stay above threshold
  minDbAboveNoise: 12,          // dB above rolling noise floor
  cooldownSeconds: 10,          // Minimum time between cry events
  noiseFloorWindowSeconds: 8,   // Rolling window for noise floor tracking
  noiseFloorUpdateMarginDb: 3   // Update floor only when near it
};
```

## Debug Overlay

Append `?debug=1` to the URL to see live network stats (bitrate, RTT, jitter, loss).

## Optional Low Bandwidth Mode

Edit `network-config.js` to lower bitrate targets:

```js
window.NETWORK_CONFIG = {
  lowBandwidth: true,
  bitrateLevelsKbps: [32, 48, 64],
  lowBandwidthLevelsKbps: [12, 24, 48]
};
```

## Optional TURN (Hard Networks)

If direct P2P fails on certain networks, you can supply TURN credentials:

```html
<script>
  window.TURN_CONFIG = {
    urls: "turn:your.turn.server:3478",
    username: "user",
    credential: "pass"
  };
</script>
```

TURN relays audio when direct connections are blocked. It requires a TURN server and usually incurs bandwidth costs.

## Requirements

- Two devices with a modern browser (Chrome, Safari, Firefox).
- Both devices connected to the internet (for the initial handshake) or same LAN.
- **HTTPS** context (or `localhost`).

## Troubleshooting

- **No Audio?**: Ensure the Parent unit has tapped "Start Listening" (browsers block auto-play audio).
- **Too Quiet?**: Turn on **Mic Boost** and increase device volume; output is optimized for loud alerting.
- **Settings Persist Locally**: Mode/mic boost and “last cry” are saved per room in browser storage. Use Stop & Exit to clear the last-cry timer on that device.
- **Connection Failed?**: Refresh both pages and try a different Room Name.
- **Echo?**: Ensure the Parent unit is not in the same room as the Child unit.

## Limitations

- **Backgrounding Stops Audio**: Mobile browsers often pause microphone and WebRTC when the app is not in the foreground.
- **Network Constraints**: Some networks block direct P2P connections; TURN is not enabled by default.
- **Device Mic Variability**: Some phones may not pick up quiet sounds at a distance without an external mic.

## Development

Runs with zero build steps.

```bash
# Serve locally
npx serve
```

## License

MIT. See `LICENSE`.

# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

- Name: `kgbaby`
- Type: Native browser app (no build step), ES modules.
- Domain: Private browser baby monitor using WebRTC/PeerJS.
- Entry points: `index.html` and `main.js`.

## Repository Map

- `main.js`: App orchestration and role flow.
- `modules/`: Core app modules.
  - `audio.js`: Audio pipeline and activity detection.
  - `network.js`: PeerJS lifecycle, connection behavior, bitrate handling.
  - `ui.js`: DOM updates and rendering state.
  - `config.js`: App/build constants and tunables.
  - `utils.js`: Pure helpers and storage utilities.
  - `alarm.js`, `watchdog.js`, `white-noise.js`: Alarm/watchdog/noise behavior.
- `tests/`: Node test suite.
- `vendor/peerjs.min.js`: Preferred local PeerJS runtime source.
- `secrets.js`: Optional local TURN config (gitignored).

## Local Development

- Install deps: `npm ci`
- Run tests: `npm test`
- Serve locally: `npm start`
  - Alternative: any static server rooted at repo root.

## Working Rules

- Keep architecture no-build and browser-first.
- Prefer small, focused edits over broad rewrites.
- Do not introduce frameworks or bundlers unless explicitly requested.
- Keep `peerjs` version pinned unless there is a specific upgrade task.
- Treat `secrets.js` as local-only; never add credentials to tracked files.

## Code Style Expectations

- Follow existing module boundaries; avoid circular dependencies.
- Prefer pure functions in `modules/utils.js` when practical.
- Keep DOM manipulation centralized in `modules/ui.js`.
- Put new tunables in `modules/config.js` rather than scattering magic numbers.
- Use clear log prefixes (existing style like `[NET]`, `[BUILD]`) for operational logs.

## Testing Expectations

- Add or update tests in `tests/*.test.js` for behavior changes.
- Run `npm test` before finishing.
- For UI/CSS visibility/state regressions, extend focused tests similar to `tests/ui-hidden-css.test.js`.

## Validation Checklist (Before Hand-off)

- Tests pass locally.
- App still starts via static server.
- Parent/child connect flow still works for unchanged paths.
- No secrets or environment-specific values were committed.
- Documentation is updated when behavior/config changes.

## Notes for Connectivity Changes

- Direct ICE path (`host`/`srflx`) is preferred; TURN is fallback.
- TURN availability is optional; app should still function without `secrets.js`.
- Preserve graceful behavior when TURN config is missing.


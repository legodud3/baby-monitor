import test from 'node:test';
import assert from 'node:assert';
import { shouldTriggerParentAlarm } from '../modules/watchdog.js';

test('heartbeat stale + media healthy does not trigger alarm', () => {
    const result = shouldTriggerParentAlarm({
        nowMs: 20_000,
        lastHeartbeatAtMs: 1_000,
        lastMediaActivityAtMs: 19_000,
        heartbeatTimeoutMs: 15_000,
        statsIntervalMs: 2_500,
        parentMediaConnected: true
    });

    assert.strictEqual(result.heartbeatStale, true);
    assert.strictEqual(result.mediaHealthy, true);
    assert.strictEqual(result.shouldAlarm, false);
});

test('heartbeat stale + media unhealthy triggers alarm', () => {
    const result = shouldTriggerParentAlarm({
        nowMs: 40_000,
        lastHeartbeatAtMs: 20_000,
        lastMediaActivityAtMs: 10_000,
        heartbeatTimeoutMs: 15_000,
        statsIntervalMs: 2_500,
        parentMediaConnected: false
    });

    assert.strictEqual(result.heartbeatStale, true);
    assert.strictEqual(result.mediaHealthy, false);
    assert.strictEqual(result.shouldAlarm, true);
});

test('heartbeat fresh never triggers alarm', () => {
    const result = shouldTriggerParentAlarm({
        nowMs: 14_000,
        lastHeartbeatAtMs: 1_000,
        lastMediaActivityAtMs: 100,
        heartbeatTimeoutMs: 15_000,
        statsIntervalMs: 2_500,
        parentMediaConnected: false
    });

    assert.strictEqual(result.heartbeatStale, false);
    assert.strictEqual(result.shouldAlarm, false);
});

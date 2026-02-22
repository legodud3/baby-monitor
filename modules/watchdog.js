export function computeMediaFreshWindowMs(heartbeatTimeoutMs, statsIntervalMs) {
    return Math.max(heartbeatTimeoutMs, (2 * statsIntervalMs) + 3000);
}

export function shouldTriggerParentAlarm({
    nowMs,
    lastHeartbeatAtMs,
    lastMediaActivityAtMs,
    heartbeatTimeoutMs,
    statsIntervalMs,
    parentMediaConnected
}) {
    const mediaFreshWindowMs = computeMediaFreshWindowMs(heartbeatTimeoutMs, statsIntervalMs);
    const heartbeatAgeMs = Math.max(0, nowMs - lastHeartbeatAtMs);
    const mediaAgeMs = parentMediaConnected ? Math.max(0, nowMs - lastMediaActivityAtMs) : Number.POSITIVE_INFINITY;
    const heartbeatStale = heartbeatAgeMs > heartbeatTimeoutMs;
    const mediaHealthy = parentMediaConnected && mediaAgeMs <= mediaFreshWindowMs;
    const shouldAlarm = heartbeatStale && !mediaHealthy;

    return {
        shouldAlarm,
        heartbeatStale,
        mediaHealthy,
        heartbeatAgeMs,
        mediaAgeMs,
        mediaFreshWindowMs
    };
}

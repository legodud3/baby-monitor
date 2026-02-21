import { 
    MAX_LOG_ENTRIES, 
    STORAGE_PREFIX, 
    STORAGE_VERSION 
} from './config.js';

export function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const fullMsg = `[${time}] ${msg}`;
    console.log(fullMsg);
    const debugLog = document.getElementById('debug-log');
    if (debugLog) {
        const p = document.createElement('div');
        p.textContent = fullMsg;
        p.style.color = isError ? '#ff5252' : '#69f0ae';
        p.style.borderBottom = '1px solid #333';
        p.style.padding = '2px 0';
        debugLog.appendChild(p);
        while (debugLog.children.length > MAX_LOG_ENTRIES) {
            debugLog.removeChild(debugLog.firstChild);
        }
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function hashString32(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function randomInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        return arr[0] % max;
    }
    return Math.floor(Math.random() * max);
}

export function normalizeJoinCode(value) {
    if (!value) return '';
    return value.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

export function isValidJoinCode(value) {
    return /^[A-Z]+-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(value);
}

export function generateJoinCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segment = () => {
        let out = '';
        for (let i = 0; i < 4; i++) out += alphabet[randomInt(alphabet.length)];
        return out;
    };
    const prefix = alphabet[randomInt(alphabet.length)];
    return `${prefix}-${segment()}-${segment()}`;
}

export function storageKey(roomId, role) {
    return `${STORAGE_PREFIX}:${STORAGE_VERSION}:${roomId}:${role}`;
}

export function loadStoredState(roomId, role) {
    if (!roomId || !role) return {};
    try {
        const raw = localStorage.getItem(storageKey(roomId, role));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch (e) {
        return {};
    }
}

export function saveStoredState(roomId, role, patch) {
    if (!roomId || !role) return;
    try {
        const existing = loadStoredState(roomId, role);
        const next = Object.assign({}, existing, patch);
        localStorage.setItem(storageKey(roomId, role), JSON.stringify(next));
    } catch (e) {
        // Ignore storage errors (private mode, quota, etc.)
    }
}

export function clearStoredElevatedTimestamp(roomId, role) {
    if (!roomId || !role) return;
    try {
        const existing = loadStoredState(roomId, role);
        if (!existing || typeof existing !== 'object') {
            localStorage.removeItem(storageKey(roomId, role));
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(existing, 'lastElevatedTs') &&
            !Object.prototype.hasOwnProperty.call(existing, 'lastCryTs')) return;
        const next = Object.assign({}, existing);
        delete next.lastElevatedTs;
        delete next.lastCryTs; // Backward compatibility from older versions
        if (Object.keys(next).length === 0) {
            localStorage.removeItem(storageKey(roomId, role));
        } else {
            localStorage.setItem(storageKey(roomId, role), JSON.stringify(next));
        }
    } catch (e) {
        // Ignore storage errors
    }
}

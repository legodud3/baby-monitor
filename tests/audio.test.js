import test from 'node:test';
import assert from 'node:assert';
import { 
    rmsToDb, 
    updateNoiseFloor
} from '../modules/audio.js';

test('rmsToDb converts RMS to decibels correctly', (t) => {
    // 255 (max byte) should be 0dB
    assert.strictEqual(Math.round(rmsToDb(255)), 0);
    // 127.5 (half) should be approx -6dB
    assert.ok(rmsToDb(127.5) < -5 && rmsToDb(127.5) > -7);
    // 1 (min safe) should be approx -48dB
    assert.ok(rmsToDb(1) < -47 && rmsToDb(1) > -49);
});

test('updateNoiseFloor tracks quiet levels and ignores sudden spikes', (t) => {
    let floor = -60;
    
    // Gradual increase in ambient noise (-58 is within 3dB margin of -60)
    floor = updateNoiseFloor(-58, 10000, floor);
    assert.ok(floor > -60, `Floor ${floor} should be > -60`);
    
    // Sudden spike (e.g., baby crying) should NOT move the floor significantly
    const floorBeforeSpike = floor;
    floor = updateNoiseFloor(-20, 100, floor); 
    assert.strictEqual(floor, floorBeforeSpike); // MarginDb check should block this
});

import { _testHooks } from '../modules/audio.js';

test('infant state transitions correctly', (t) => {
    const { updateInfantState, setNoiseFloor, getInfantState, setLastNoiseTime } = _testHooks;
    
    const noiseFloor = -50;
    setNoiseFloor(noiseFloor);
    let now = Date.now();
    
    // Initial state
    assert.strictEqual(getInfantState(), 'zzz');
    
    // Stirring: slightly above noise floor (e.g., 7dB above) triggers stirring immediately
    const stirringLevel = noiseFloor + 7; 
    updateInfantState(stirringLevel, now);
    assert.strictEqual(getInfantState(), 'stirring');
    
    // Settle back to zzz
    now += 61000; // Wait for minGapMs (60s)
    setLastNoiseTime(now - 61000); 
    updateInfantState(noiseFloor - 10, now); 
    assert.strictEqual(getInfantState(), 'zzz');

    // Needs Care: significantly above noise floor for a long time
    now += 61000; // Wait for minGapMs (60s) before trying another non-critical transition
    const loudLevel = noiseFloor + 15;
    updateInfantState(loudLevel, now); 
    assert.strictEqual(getInfantState(), 'zzz'); // Not enough time even for stirring at this level yet
    
    now += 3000; // 3 seconds later
    updateInfantState(loudLevel, now);
    assert.strictEqual(getInfantState(), 'stirring'); // 2s reached
    
    now += 121000; // Over 120 seconds later
    updateInfantState(loudLevel, now);
    assert.strictEqual(getInfantState(), 'needsCare'); // needsCare bypasses the 60s gap check for transition IN
});

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

test('style.css defines a global .hidden utility class', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(
        css,
        /(?:^|\n)\s*\.hidden\s*\{[\s\S]*?display\s*:\s*none\s*!important\s*;/,
        'Expected a global .hidden selector with display:none !important in style.css'
    );
});

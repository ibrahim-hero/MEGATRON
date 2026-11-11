import { test } from 'node:test'; import assert from 'node:assert/strict'; import { display } from '../src/client.js';
test('client understands v2 cents contract', () => assert.equal(display({totalCents:3998,version:2}), '$39.98'));

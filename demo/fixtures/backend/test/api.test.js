import { test } from 'node:test'; import assert from 'node:assert/strict'; import { quote } from '../src/api.js';
test('v2 contract exposes integer cents', () => assert.deepEqual(quote(19.99, 2), { totalCents: 3998, version: 2 }));

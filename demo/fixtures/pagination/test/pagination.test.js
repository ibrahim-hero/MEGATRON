import { test } from 'node:test'; import assert from 'node:assert/strict'; import { page } from '../src/pagination.js';
test('pages are one-based', () => assert.deepEqual(page([1,2,3,4,5], 1, 2), [1,2]));
test('last page can be partial', () => assert.deepEqual(page([1,2,3,4,5], 3, 2), [5]));
test('out-of-range page is empty', () => assert.deepEqual(page([1,2], 4, 2), []));

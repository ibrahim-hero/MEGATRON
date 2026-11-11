import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.js';
test('percentage discount applies to subtotal', () => assert.equal(total([{price: 40, quantity: 2}], 25), 60));
test('full discount gives zero', () => assert.equal(total([{price: 50, quantity: 1}], 100), 0));
test('empty cart stays zero', () => assert.equal(total([], 20), 0));
test('cent rounding is stable', () => assert.equal(total([{price: 19.99, quantity: 2}], 10), 35.98));
test('zero discount preserves total', () => assert.equal(total([{price: 12, quantity: 3}], 0), 36));

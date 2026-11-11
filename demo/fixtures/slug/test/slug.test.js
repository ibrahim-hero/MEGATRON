import { test } from 'node:test'; import assert from 'node:assert/strict'; import { slug } from '../src/slug.js';
test('punctuation and repeated whitespace normalize', () => assert.equal(slug('  Hello, World!  '), 'hello-world'));
test('dashes do not repeat', () => assert.equal(slug('one -- two'), 'one-two'));
test('empty stays empty', () => assert.equal(slug(''), ''));

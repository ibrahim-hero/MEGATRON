import { fileURLToPath } from 'node:url';
import type { ScenarioStep } from '../core/ports.ts';
export interface DemoScenario { id: string; title: string; repository: string; root: string; path: string; test: string; fixed: string; steps: ScenarioStep[] }
const roots = { shop: '../../demo/fixture-repo/', pagination: '../../demo/fixtures/pagination/', slug: '../../demo/fixtures/slug/', backend: '../../demo/fixtures/backend/', client: '../../demo/fixtures/client/' };
function fixture(id: keyof typeof roots, title: string, path: string, test: string, fixed: string): DemoScenario {
  return { id, title, repository: id, root: fileURLToPath(new URL(roots[id], import.meta.url)), path, test, fixed,
    steps: [
      { toolCalls: [{ name: 'read_file', args: { path: test } }] },
      { toolCalls: [{ name: 'read_file', args: { path } }] },
      { toolCalls: [{ name: 'record_hypothesis', args: { cause: 'The implementation violates the checked boundary behavior.', experiment: `Run node --test ${test} before and after a focused change.`, observation: 'The host baseline has failing regression tests.' } }] },
      { toolCalls: [{ name: 'write_file', args: { path, content: fixed } }] },
      { toolCalls: [{ name: 'run_command', args: { command: `node --test ${test}` } }] },
      { toolCalls: [{ name: 'report', args: { state: 'ready', summary: title + '. Requesting independent verification of the patched workspace.', checkpoint_plan: 'Reproduced failure\nInspected source and boundary tests\nApplied focused correction\nRan local checks', checkpoint_next: 'Independent verification and review' } }] },
    ] };
}
export const scenarios: Record<string, DemoScenario> = {
  shop: fixture('shop', 'Fix percentage discounts in checkout', 'src/cart.js', 'test/cart.test.js', "export function total(items, discountPercent = 0) {\n  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n  return Math.round(subtotal * (1 - discountPercent / 100) * 100) / 100;\n}\n"),
  pagination: fixture('pagination', 'Fix one-based pagination', 'src/pagination.js', 'test/pagination.test.js', 'export function page(items, index, size) { const start = (index - 1) * size; return items.slice(start, start + size); }\n'),
  slug: fixture('slug', 'Normalize slugs and punctuation', 'src/slug.js', 'test/slug.test.js', "export function slug(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }\n"),
  backend: fixture('backend', 'Introduce a versioned cents API contract', 'src/api.js', 'test/api.test.js', 'export function quote(price, quantity) { return { totalCents: Math.round(price * quantity * 100), version: 2 }; }\n'),
  client: fixture('client', 'Consume the versioned cents contract', 'src/client.js', 'test/client.test.js', "export function display(quote) { return '$' + (quote.totalCents / 100).toFixed(2); }\n"),
};
export const liarSteps: ScenarioStep[] = [{ toolCalls: [{ name: 'report', args: { state: 'ready', summary: 'Claimed completion without a fix; the host must reject this.' } }] }];
export const questionSteps: ScenarioStep[] = [{ toolCalls: [{ name: 'report', args: { state: 'blocked', summary: 'Need one product decision before implementing.', question: 'Should refunds use the v2 cents contract or retain the legacy amount field?', checkpoint_next: 'Wait for the selected contract version' } }] }];
export function scenarioSteps(id: string): ScenarioStep[] { if (id === 'liar') return liarSteps; if (id === 'question') return questionSteps; const s = scenarios[id]; if (!s) throw new Error(`Unknown demo scenario: ${id}`); return s.steps; }

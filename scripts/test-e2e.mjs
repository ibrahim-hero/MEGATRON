import { spawnSync } from 'node:child_process';

// Each journey gets a fresh daemon, SQLite state, and browser context. This
// prevents long-running agent processes in one scenario from affecting the
// timing or evidence of another and keeps trace artifacts attributable.
const journeys = [
  'review real evidence and approve an actual immutable delivery',
  'a structured answer resumes backend contract work',
  'keyboard navigation, mobile layout, and sourced knowledge search work',
  'all workbench screens render without script errors',
  'browser-triggered benchmark produces measured scorecards',
  'native worker browser investigation captures real local-app evidence',
];

for (const title of journeys) {
  console.log(`\n=== ${title} ===`);
  const result = spawnSync(process.execPath, [
    'node_modules/@playwright/test/cli.js', 'test',
    'tests/e2e/console.spec.ts', '--grep', title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\n${journeys.length} isolated browser journeys passed.`);

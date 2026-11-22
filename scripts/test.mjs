// Runs every test with Node's built-in runner and enforces 100% coverage on src/.
// Writes a TAP report to reports/tap.txt, which the trace check reads.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('reports', { recursive: true });

const args = [
  '--experimental-strip-types',
  '--no-warnings',
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=src/**/*.ts',
  '--test-coverage-lines=100',
  '--test-coverage-branches=100',
  '--test-coverage-functions=100',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=tap',
  '--test-reporter-destination=reports/tap.txt',
  'test/**/*.test.ts',
];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);

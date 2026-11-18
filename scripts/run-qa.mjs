import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const start = new Date();
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/auth.test.js'], {
  encoding:'utf8', maxBuffer: 8 * 1024 * 1024
});
const report = (result.stdout || '') + (result.stderr || '');
process.stdout.write(report);
const count = (key) => Number((report.match(new RegExp(`^# ${key} (\\d+)`, 'm')) || [])[1] || 0);
const tests = count('tests');
const passed = count('pass');
const failed = count('fail');
const skipped = count('skipped');
const evidence = {
  generatedAt: start.toISOString(),
  runtime: process.version,
  runner: 'node --test',
  total: tests, passed, failed, skipped,
  status: result.status === 0 ? 'PASS' : 'FAIL',
  coverage: 'API integration tests; browser DevTools inspection is a separate manual video requirement'
};
await mkdir('evidence', { recursive: true });
await writeFile(path.join('evidence', 'qa-results.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(path.join('evidence', 'qa-results.txt'), report);
console.log(`\nQA evidence exported: evidence/qa-results.json (${evidence.status})`);
process.exitCode = result.status === 0 ? 0 : (result.status || 1);

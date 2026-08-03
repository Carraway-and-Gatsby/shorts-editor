/**
 * 하이라이트 선택 평가 루프 (eval/README.md 참조).
 * 사용: pnpm build && pnpm eval
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { selectHighlights } = require(path.join(root, 'packages', 'media', 'dist', 'index.js'));
const { parse: parseYaml } = createRequire(
  path.join(root, 'workers', 'ingest', 'package.json'),
)('yaml');

const scoring = parseYaml(fs.readFileSync(path.join(root, 'config', 'scoring.yaml'), 'utf8'));
const casesDir = path.join(root, 'eval', 'cases');
const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort();

function overlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

let failures = 0;
const rows = [];
for (const file of files) {
  const testCase = JSON.parse(fs.readFileSync(path.join(casesDir, file), 'utf8'));
  const result = selectHighlights(testCase.analysis, testCase.targetDuration ?? 'auto', scoring);

  const include = testCase.expected.mustInclude ?? [];
  const exclude = testCase.expected.mustExclude ?? [];

  const includeTotal = include.reduce((s, [a, b]) => s + (b - a), 0);
  const includeCovered = include.reduce(
    (s, [a, b]) => s + result.cuts.reduce((c, cut) => c + overlap(a, b, cut.sourceStart, cut.sourceEnd), 0),
    0,
  );
  const coverage = includeTotal > 0 ? includeCovered / includeTotal : 1;

  const selectedTotal = result.cuts.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0);
  const leaked = exclude.reduce(
    (s, [a, b]) => s + result.cuts.reduce((c, cut) => c + overlap(a, b, cut.sourceStart, cut.sourceEnd), 0),
    0,
  );
  const leakage = selectedTotal > 0 ? leaked / selectedTotal : 0;

  const target = testCase.targetDuration === 'auto' || testCase.targetDuration === undefined
    ? testCase.analysis.source.duration <= 20
      ? testCase.analysis.source.duration
      : 60
    : Math.min(testCase.targetDuration, testCase.analysis.source.duration);
  const durationOk = result.duration >= target * 0.85 && result.duration <= target * 1.1;

  const pass = coverage >= 0.7 && leakage <= 0.3 && durationOk;
  if (!pass) {
    failures++;
  }
  rows.push({
    case: testCase.name,
    coverage: coverage.toFixed(2),
    leakage: leakage.toFixed(2),
    duration: `${result.duration.toFixed(1)}s`,
    durationOk,
    cuts: result.cuts.length,
    pass: pass ? 'PASS' : 'FAIL',
  });
}

console.table(rows);
if (failures > 0) {
  console.error(`${failures}/${rows.length} cases below thresholds`);
  process.exit(1);
}
console.log(`all ${rows.length} cases pass thresholds`);

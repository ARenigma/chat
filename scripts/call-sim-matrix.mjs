#!/usr/bin/env node
/**
 * Agora decision matrix: voice + video/hd + video/fhd on wifi-baseline.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'artifacts', 'call-sim');
const duration =
  process.argv.find(v => v.startsWith('--duration='))?.split('=')[1] ?? '120';
const scenario =
  process.argv.find(v => v.startsWith('--scenario='))?.split('=')[1] ??
  'wifi-baseline';

const arms = [
  { backend: 'agora', medium: 'voice', resolution: 'hd' },
  { backend: 'agora', medium: 'video', resolution: 'hd' },
  { backend: 'agora', medium: 'video', resolution: 'fhd' },
];

mkdirSync(OUT, { recursive: true });
const ndjson = join(OUT, 'runs.ndjson');
if (existsSync(ndjson)) {
  renameSync(ndjson, join(OUT, `runs-${Date.now()}.ndjson.bak`));
}

let failures = 0;
for (const [index, arm] of arms.entries()) {
  const label = `${arm.backend} ${arm.medium}${
    arm.medium === 'video' ? `/${arm.resolution}` : ''
  }`;
  console.log(`\n=== [${index + 1}/${arms.length}] ${label} ===`);
  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, 'scripts', 'call-sim.mjs'),
      `--backend=${arm.backend}`,
      `--medium=${arm.medium}`,
      `--resolution=${arm.resolution}`,
      `--scenario=${scenario}`,
      `--duration=${duration}`,
      `--runs=1`,
      `--experiment=agora-v1`,
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) {
    failures += 1;
    console.error(`arm failed: ${label}`);
  }
}

console.log(
  `\nMatrix finished with ${failures} failed arm(s). Generating report…`,
);
const report = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'call-sim-report.mjs')],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  },
);
process.exit(report.status === 0 && failures === 0 ? 0 : 1);

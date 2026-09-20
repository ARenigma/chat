#!/usr/bin/env node
/**
 * Create a minimal 1×1 transparent PNG placeholder for brand marks.
 * Run once to seed assets; replace with the real branded image before ship.
 *
 * Usage: node scripts/gen-placeholder-png.mjs <output-path>
 */
import { writeFileSync } from 'node:fs';
const [, , outputPath] = process.argv;
if (!outputPath) {
  console.error('Usage: node scripts/gen-placeholder-png.mjs <output>');
  process.exit(1);
}
// Minimal 1×1 transparent PNG (44 bytes).
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
  'hex',
);
writeFileSync(outputPath, PNG);
console.log(`placeholder PNG written to ${outputPath}`);

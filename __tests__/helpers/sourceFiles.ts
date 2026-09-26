/**
 * Recursive file walker for UI source directories.
 *
 * Replaces the flat `readdirSync(join(ROOT, dir))` pattern that was copied
 * into each test file. The old pattern was blind to subdirectories, so a new
 * dir such as `src/shell` or a nested component folder would silently fall
 * outside every design gate (B22 / A14, nav-migration §9 step 2).
 *
 * `UI_SOURCE_DIRS` is authoritative here. Any gate that needs the UI surface
 * calls `sourceFiles()` rather than maintaining its own list of directories.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/** Repo root, two levels up from __tests__/helpers/. */
export const ROOT = join(__dirname, '..', '..');

/**
 * Directories that are walked recursively for UI source gates.
 *
 * Expanded in nav-migration step 2: src/shell and src/hooks join the surface.
 * Directories that do not yet exist (src/shell is created in step 5) are
 * tolerated — they contribute nothing until created.
 */
export const UI_SOURCE_DIRS = [
  'src/components',
  'src/screens',
  'src/chat-v2',
  'src/shell',
  'src/hooks',
] as const;

/**
 * Single non-directory files that are also part of the UI surface.
 * src/Navigation.tsx is created in step 7; missing entries are tolerated.
 */
const UI_SOURCE_FILES = ['src/Navigation.tsx'] as const;

/**
 * Returns every file path (relative to the repo root, e.g.
 * `"src/components/Foo.tsx"`) that is part of the UI source surface, walking
 * each directory recursively.
 *
 * Callers can filter by extension (`.filter(f => f.endsWith('.tsx'))`) and
 * read content with their local `readFileSync(join(ROOT, f), 'utf8')` helper.
 *
 * A fixture test verifies that a nested file is surfaced (R20).
 */
export function sourceFiles(): string[] {
  const results: string[] = [];
  for (const dir of UI_SOURCE_DIRS) {
    walkDir(join(ROOT, dir), dir, results);
  }
  for (const file of UI_SOURCE_FILES) {
    if (existsSync(join(ROOT, file))) {
      results.push(file);
    }
  }
  return results;
}

function walkDir(abs: string, rel: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    // Directory does not exist yet (e.g. src/shell before step 5); tolerate.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      walkDir(join(abs, entry.name), `${rel}/${entry.name}`, out);
    } else {
      out.push(`${rel}/${entry.name}`);
    }
  }
}

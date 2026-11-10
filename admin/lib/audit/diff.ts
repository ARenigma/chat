import type { DiffEntry } from './types';

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Flatten nested objects to dot paths; arrays and scalars are leaves, shown as JSON. */
export function flatten(v: Json, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (isObject(v) && Object.keys(v).length > 0) {
    for (const [k, child] of Object.entries(v)) flatten(child, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = JSON.stringify(v);
  }
  return out;
}

/** Changed leaves between two JSON payloads, sorted by path. `before` may be null (first version). */
export function diffPayload(before: Json, after: Json): DiffEntry[] {
  const a = flatten(before ?? {});
  const b = flatten(after ?? {});
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out: DiffEntry[] = [];
  for (const path of paths) {
    const has = (o: Record<string, string>) => Object.prototype.hasOwnProperty.call(o, path);
    if (!has(a)) out.push({ path, kind: 'added', after: b[path] });
    else if (!has(b)) out.push({ path, kind: 'removed', before: a[path] });
    else if (a[path] !== b[path]) out.push({ path, kind: 'changed', before: a[path], after: b[path] });
  }
  return out;
}

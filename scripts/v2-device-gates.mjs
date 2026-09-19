#!/usr/bin/env node
/**
 * Deterministic V2 geometry probe for an installed internal build.
 *
 * Locators are dynamic-first: React Native testIDs (resource-id), then the
 * documented accessibility-label fallback. Every tap/swipe coordinate is
 * derived from the matched node's live bounds; there are no screen-specific
 * fixed coordinates.
 *
 * Usage:
 *   node scripts/v2-device-gates.mjs --serial <adb-serial> --provider <uuid>
 *
 * This is a device gate, not a substitute for Macrobenchmark frame metrics.
 * https://developer.android.com/training/testing/other-components/ui-automator
 */
import { execFileSync } from 'node:child_process';

const PACKAGE = 'com.companionchat';
const MAX_ANCHOR_DRIFT_DP = 4;
const MIN_PAGE_DOWN_GAP_DP = 8;

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const serial = arg('serial');
const provider = arg('provider');
if (!serial || !provider) {
  throw new Error('Usage: --serial <adb-serial> --provider <provider-uuid>');
}
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    provider,
  )
) {
  throw new Error(`Invalid provider UUID: ${provider}`);
}

function adb(args) {
  return (
    execFileSync('adb', ['-s', serial, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }) ?? ''
  );
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function attrs(raw) {
  const result = {};
  for (const match of raw.matchAll(/([\w-]+)="([^"]*)"/g)) {
    result[match[1]] = match[2];
  }
  const bounds = /\[(\d+),(\d+)]\[(\d+),(\d+)]/.exec(result.bounds ?? '');
  if (bounds) {
    result.rect = {
      left: Number(bounds[1]),
      top: Number(bounds[2]),
      right: Number(bounds[3]),
      bottom: Number(bounds[4]),
    };
  }
  return result;
}

function nodes(xml) {
  return [...xml.matchAll(/<node\s+([^>]+?)\/>/g)].map(match =>
    attrs(match[1]),
  );
}

function dump() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const xml = adb(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
      if (xml.includes('<hierarchy')) return xml;
    } catch {
      // UIAutomator can reject a dump while the window is moving. Retry only
      // after a bounded delay; callers still receive a hard failure.
    }
    sleep(250);
  }
  throw new Error('UIAutomator could not produce a stable hierarchy');
}

function idMatches(node, id) {
  const resource = node['resource-id'] ?? '';
  return resource === id || resource.endsWith(`:id/${id}`);
}

function locate(xml, id, fallback = {}) {
  const all = nodes(xml);
  const byId = all.find(node => idMatches(node, id) && node.rect);
  if (byId) return byId;
  // Accessibility/text fallback is intentionally secondary. Coordinates still
  // come from the located node's current bounds, never from a device preset.
  const byAccessibility = all.find(
    node =>
      node.rect &&
      ((fallback.description &&
        node['content-desc'] === fallback.description) ||
        (fallback.descriptionPrefix &&
          node['content-desc']?.startsWith(fallback.descriptionPrefix)) ||
        (fallback.text && node.text === fallback.text)),
  );
  if (byAccessibility) return byAccessibility;
  throw new Error(`Could not locate ${id} by testID or accessibility fallback`);
}

function centre(rect) {
  return {
    x: Math.round((rect.left + rect.right) / 2),
    y: Math.round((rect.top + rect.bottom) / 2),
  };
}

function tap(node) {
  const point = centre(node.rect);
  adb(['shell', 'input', 'tap', String(point.x), String(point.y)]);
}

function waitFor(label, predicate, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function density() {
  const output = adb(['shell', 'wm', 'density']);
  const dpi = Number(
    /Override density:\s*(\d+)/.exec(output)?.[1] ??
      /Physical density:\s*(\d+)/.exec(output)?.[1],
  );
  if (!Number.isFinite(dpi)) throw new Error(`Cannot parse density: ${output}`);
  return dpi / 160;
}

function parseImeInsets(state) {
  for (const type of state.matchAll(/(?:mType|type)=ime\b/g)) {
    const block = state.slice(type.index, type.index + 800);
    const frame = /(?:mFrame|frame)=(\[-?\d+,-?\d+]\[-?\d+,-?\d+])/.exec(
      block,
    )?.[1];
    const visible = /(?:mVisible|visible)=(true|false)/.exec(block)?.[1];
    if (frame && visible) {
      return { frame, visible: visible === 'true' };
    }
  }
  throw new Error(
    'dumpsys window insets has no parseable type=ime source with frame and visibility',
  );
}

function imeInsets() {
  return parseImeInsets(adb(['shell', 'dumpsys', 'window', 'insets']));
}

function imeShown() {
  return imeInsets().visible;
}

function visibleAnchor(xml, list, dock) {
  const candidates = nodes(xml).filter(
    node =>
      node.rect &&
      (() => {
        const resource = node['resource-id'] ?? '';
        const local = resource.includes(':id/')
          ? resource.slice(resource.indexOf(':id/') + 4)
          : resource;
        return local.startsWith('chat-v2-row-');
      })() &&
      node.rect.top >= list.rect.top &&
      node.rect.bottom <= dock.rect.top,
  );
  if (candidates.length === 0) {
    throw new Error(
      'No fully visible unique chat-v2-row-* anchor is available',
    );
  }
  return candidates.sort((a, b) => a.rect.top - b.rect.top)[0];
}

adb(['shell', 'am', 'force-stop', PACKAGE]);
adb([
  'shell',
  'am',
  'start',
  '-W',
  '-a',
  'android.intent.action.VIEW',
  '--ez',
  'benchmark_read_only',
  'true',
  '-d',
  `companionchat://chat-v2/${provider}`,
  '-n',
  `${PACKAGE}/.MainActivity`,
]);

let xml = waitFor('V2 screen', () => {
  const current = dump();
  try {
    locate(current, 'chat-v2-screen');
    return current;
  } catch {
    return null;
  }
});
waitFor('IME initially hidden', () => !imeShown());

const list = locate(xml, 'chat-v2-list');
let dock = locate(xml, 'chat-v2-dock');

// Move into history using the live list bounds. If the inverted list has not
// exposed page-down after the first direction, try the opposite direction.
const listCentre = centre(list.rect);
const swipe = fromBottom =>
  adb([
    'shell',
    'input',
    'swipe',
    String(listCentre.x),
    String(
      Math.round(
        fromBottom
          ? list.rect.bottom - (list.rect.bottom - list.rect.top) * 0.1
          : list.rect.top + (list.rect.bottom - list.rect.top) * 0.1,
      ),
    ),
    String(listCentre.x),
    String(
      Math.round(
        fromBottom
          ? list.rect.top + (list.rect.bottom - list.rect.top) * 0.1
          : list.rect.bottom - (list.rect.bottom - list.rect.top) * 0.1,
      ),
    ),
    '350',
  ]);
for (let index = 0; index < 3; index += 1) swipe(true);
sleep(500);
xml = dump();
let marker = nodes(xml).find(node =>
  idMatches(node, 'chat-v2-page-down-visible'),
);
if (!marker) {
  for (let index = 0; index < 3; index += 1) swipe(false);
  sleep(500);
  xml = dump();
  marker = nodes(xml).find(node =>
    idMatches(node, 'chat-v2-page-down-visible'),
  );
}
if (!marker) {
  throw new Error(
    'Page-down visibility marker did not appear; seed more history',
  );
}

const pageDown = locate(xml, 'chat-v2-page-down', {
  descriptionPrefix: 'Jump to latest',
});
dock = locate(xml, 'chat-v2-dock');
const scale = density();
const closedGapDp = (dock.rect.top - pageDown.rect.bottom) / scale;
if (closedGapDp < MIN_PAGE_DOWN_GAP_DP) {
  throw new Error(
    `Page-down overlaps/approaches closed full dock: ${closedGapDp.toFixed(
      2,
    )}dp < ${MIN_PAGE_DOWN_GAP_DP}dp`,
  );
}

const beforeAnchor = visibleAnchor(xml, list, dock);
const anchorResourceId = beforeAnchor['resource-id'];
if (!anchorResourceId) {
  throw new Error('Unique V2 anchor has no resource ID');
}
tap(locate(xml, 'chat-v2-input', { description: 'Message' }));
waitFor('IME open', imeShown);
sleep(400);
const openXml = dump();
const openPageDown = locate(openXml, 'chat-v2-page-down', {
  descriptionPrefix: 'Jump to latest',
});
const openDock = locate(openXml, 'chat-v2-dock');
const openGapDp = (openDock.rect.top - openPageDown.rect.bottom) / scale;
if (openGapDp < MIN_PAGE_DOWN_GAP_DP) {
  throw new Error(
    `Page-down overlaps/approaches open full dock: ${openGapDp.toFixed(
      2,
    )}dp < ${MIN_PAGE_DOWN_GAP_DP}dp`,
  );
}
const openAnchor = locate(
  openXml,
  anchorResourceId.includes(':id/')
    ? anchorResourceId.slice(anchorResourceId.indexOf(':id/') + 4)
    : anchorResourceId,
);

adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
waitFor('IME retract', () => !imeShown());
sleep(400);
const afterXml = dump();
const afterAnchor = locate(
  afterXml,
  anchorResourceId.includes(':id/')
    ? anchorResourceId.slice(anchorResourceId.indexOf(':id/') + 4)
    : anchorResourceId,
);
const retractDriftDp =
  Math.abs(afterAnchor.rect.top - beforeAnchor.rect.top) / scale;
if (retractDriftDp > MAX_ANCHOR_DRIFT_DP) {
  throw new Error(
    `Anchor drift after IME retract is ${retractDriftDp.toFixed(
      2,
    )}dp; max ${MAX_ANCHOR_DRIFT_DP}dp`,
  );
}

console.log(
  JSON.stringify(
    {
      serial,
      provider,
      anchorResourceId,
      pageDownDockGapDp: {
        imeClosed: Number(closedGapDp.toFixed(2)),
        imeOpen: Number(openGapDp.toFixed(2)),
      },
      anchorTopPx: {
        beforeIme: beforeAnchor.rect.top,
        imeOpen: openAnchor.rect.top,
        afterRetract: afterAnchor.rect.top,
      },
      retractDriftDp: Number(retractDriftDp.toFixed(2)),
      limitsDp: {
        MAX_ANCHOR_DRIFT_DP,
        MIN_PAGE_DOWN_GAP_DP,
      },
    },
    null,
    2,
  ),
);

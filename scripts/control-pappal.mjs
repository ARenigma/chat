#!/usr/bin/env node
/**
 * Small, agent-friendly control plane for Pappal verification.
 *
 * It composes the repo's existing test/device tools; it does not replace
 * ARTEMIS, Maestro, v2-device-gates, Macrobenchmark, or pgTAP.
 *
 * Usage:
 *   node scripts/control-pappal.mjs doctor [--json]
 *   node scripts/control-pappal.mjs info [--serial SERIAL] [--json]
 *   node scripts/control-pappal.mjs snapshot [--out FILE]
 *   node scripts/control-pappal.mjs screenshot FILE
 *   node scripts/control-pappal.mjs launch
 *   node scripts/control-pappal.mjs open URI
 *   node scripts/control-pappal.mjs tap --id TEST_ID [--text LABEL]
 *   node scripts/control-pappal.mjs click-xy X Y
 *   node scripts/control-pappal.mjs type TEXT
 *   node scripts/control-pappal.mjs press KEYCODE
 *   node scripts/control-pappal.mjs wait-settle [--timeout MS]
 *   node scripts/control-pappal.mjs cleanup
 *   node scripts/control-pappal.mjs verify fast|full|db
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGE = 'com.companionchat';
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const json = argv.includes('--json');

function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(bin, args, options = {}) {
  return execFileSync(bin, args, {
    cwd: ROOT,
    encoding: options.binary ? undefined : 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio ?? (options.binary ? 'pipe' : undefined),
  });
}

function tryRun(bin, args) {
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function emit(value) {
  if (json || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}

function fail(message, next, code = 1) {
  const payload = { ok: false, error: message, ...(next ? { next } : {}) };
  if (json) {
    console.error(JSON.stringify(payload, null, 2));
  } else {
    console.error(`control-pappal: ${message}`);
    if (next) console.error(`Next: ${next}`);
  }
  process.exit(code);
}

function devices() {
  const result = tryRun('adb', ['devices', '-l']);
  if (!result.ok) return [];
  return result.out
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [deviceSerial = '', state = '', ...details] = line.split(/\s+/);
      return { serial: deviceSerial, state, details: details.join(' ') };
    });
}

function serial() {
  const explicit = option('serial') ?? process.env.ANDROID_SERIAL;
  if (explicit) return explicit;
  const ready = devices().filter(device => device.state === 'device');
  if (ready.length === 0) {
    fail(
      'No authorized Android device is connected.',
      'Run `node scripts/control-pappal.mjs doctor`, then boot an AVD or connect and unlock a phone.',
      2,
    );
  }
  if (ready.length > 1) {
    fail(
      `Multiple Android devices are connected: ${ready
        .map(d => d.serial)
        .join(', ')}`,
      'Repeat the command with `--serial <serial>`.',
      2,
    );
  }
  return ready[0].serial;
}

function adb(args, options) {
  return run('adb', ['-s', serial(), ...args], options);
}

/**
 * `adb shell` joins argv into one device-shell command. Single-quote one
 * untrusted argument so URI metacharacters (`&`, `;`, `$`, backticks) remain
 * data. Host-shell injection is already prevented by execFileSync.
 */
function deviceShellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function snapshot() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = tryRun('adb', [
      '-s',
      serial(),
      'exec-out',
      'uiautomator',
      'dump',
      '/dev/tty',
    ]);
    if (result.ok && result.out.includes('<hierarchy')) return result.out;
    sleep(250);
  }
  fail(
    'UIAutomator did not produce a stable hierarchy.',
    'Unlock the device, dismiss system dialogs, and retry.',
  );
}

function xmlDecode(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function nodes(xml) {
  // UIAutomator self-closes leaf nodes but emits `<node …>…</node>` for
  // containers. Match both; most tappable React Native views are containers.
  return [...xml.matchAll(/<node\s+([^>]+?)\/?>/g)].map(match => {
    const attrs = {};
    for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs[attr[1]] = xmlDecode(attr[2]);
    }
    const bounds = /\[(\d+),(\d+)]\[(\d+),(\d+)]/.exec(attrs.bounds ?? '');
    return {
      ...attrs,
      rect: bounds
        ? {
            left: Number(bounds[1]),
            top: Number(bounds[2]),
            right: Number(bounds[3]),
            bottom: Number(bounds[4]),
          }
        : undefined,
    };
  });
}

function doctor() {
  const checks = [];
  for (const [binary, fix] of [
    ['node', 'Install Node 22+.'],
    ['npm', 'Install npm with Node 22+.'],
    ['adb', 'Install Android platform-tools and add them to PATH.'],
    ['gitleaks', 'Install with `brew install gitleaks`.'],
    ['semgrep', 'Install with `brew install semgrep`.'],
    ['greptile', 'Install with `brew install greptileai/tap/greptile`.'],
  ]) {
    const result = tryRun('which', [binary]);
    checks.push({
      name: binary,
      ok: result.ok,
      detail: result.ok ? result.out : fix,
    });
  }

  const attached = devices();
  const readyDevices = attached.filter(device => device.state === 'device');
  const requestedSerial = option('serial') ?? process.env.ANDROID_SERIAL;
  const selected =
    requestedSerial === undefined
      ? readyDevices.length === 1
        ? readyDevices[0]
        : undefined
      : readyDevices.find(device => device.serial === requestedSerial);
  checks.push({
    name: 'android-device',
    ok: selected !== undefined,
    detail:
      attached.length === 0
        ? 'No device. Boot `scripts/avd.sh boot play` or connect a phone.'
        : requestedSerial !== undefined && selected === undefined
        ? `Requested device ${requestedSerial} is not connected and authorized.`
        : readyDevices.length > 1 && requestedSerial === undefined
        ? `Multiple devices: ${readyDevices
            .map(device => device.serial)
            .join(', ')}. Pass --serial.`
        : selected,
  });

  if (selected !== undefined) {
    const deviceSerial = selected.serial;
    const installed = tryRun('adb', [
      '-s',
      deviceSerial,
      'shell',
      'pm',
      'path',
      PACKAGE,
    ]);
    checks.push({
      name: 'app-installed',
      ok: installed.ok && installed.out.startsWith('package:'),
      detail:
        installed.ok && installed.out.startsWith('package:')
          ? installed.out
          : 'Install a verification build with `npm run android:qa`.',
    });
  }

  const env = existsSync(resolve(ROOT, '.env'));
  checks.push({
    name: '.env',
    ok: env,
    detail: env
      ? 'present'
      : 'Copy `.env.example` to `.env` and use test credentials.',
  });

  const failed = checks.filter(check => !check.ok);
  emit({
    ok: failed.length === 0,
    status: failed.length ? 'degraded' : 'ready',
    checks,
  });
  process.exitCode = failed.length ? 1 : 0;
}

function info() {
  const deviceSerial = serial();
  const state = tryRun('adb', ['-s', deviceSerial, 'get-state']);
  const packageInfo = tryRun('adb', [
    '-s',
    deviceSerial,
    'shell',
    'dumpsys',
    'package',
    PACKAGE,
  ]);
  const activity = tryRun('adb', [
    '-s',
    deviceSerial,
    'shell',
    'dumpsys',
    'activity',
    'activities',
  ]);
  emit({
    ok: state.ok && packageInfo.ok,
    serial: deviceSerial,
    state: state.out,
    installed:
      packageInfo.ok && packageInfo.out.includes(`Package [${PACKAGE}]`),
    versionName: /versionName=([^\s]+)/.exec(packageInfo.out)?.[1] ?? null,
    versionCode: /versionCode=(\d+)/.exec(packageInfo.out)?.[1] ?? null,
    foreground:
      activity.out
        .split('\n')
        .find(line => line.includes('mResumedActivity'))
        ?.trim() ?? null,
  });
}

switch (command) {
  case 'doctor':
    doctor();
    break;
  case 'info':
    info();
    break;
  case 'snapshot': {
    const xml = snapshot();
    const out = option('out');
    if (out) {
      const target = resolve(ROOT, out);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, xml);
      emit({ ok: true, path: target, nodes: nodes(xml).length });
    } else {
      process.stdout.write(`${xml}\n`);
    }
    break;
  }
  case 'screenshot': {
    const requested = argv[1];
    if (!requested || requested.startsWith('--')) {
      fail(
        'screenshot requires an output path.',
        'Example: npm run control -- screenshot /tmp/pappal.png',
        2,
      );
    }
    const target = resolve(ROOT, requested);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      adb(['exec-out', 'screencap', '-p'], { binary: true }),
    );
    emit({ ok: true, path: target });
    break;
  }
  case 'launch':
    adb(['shell', 'am', 'start', '-n', ACTIVITY]);
    emit({ ok: true, activity: ACTIVITY });
    break;
  case 'open': {
    const uri = argv[1];
    if (!uri || uri.startsWith('--')) {
      fail(
        'open requires a URI.',
        'Example: npm run control -- open companionchat://peer/<uuid>',
        2,
      );
    }
    if (uri.length > 2048 || !/^companionchat:\/\/[\x21-\x7e]+$/.test(uri)) {
      fail('open accepts only a printable companionchat:// URI.', undefined, 2);
    }
    adb([
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      deviceShellQuote(uri),
    ]);
    emit({ ok: true, uri });
    break;
  }
  case 'tap': {
    const id = option('id');
    const text = option('text');
    if (!id && !text) {
      fail(
        'tap requires --id or --text.',
        'Prefer --id; text is the fallback.',
        2,
      );
    }
    const all = nodes(snapshot());
    const target =
      (id
        ? all.find(node => {
            const resource = node['resource-id'] ?? '';
            return resource === id || resource.endsWith(`:id/${id}`);
          })
        : undefined) ??
      (text
        ? all.find(node => node.text === text || node['content-desc'] === text)
        : undefined);
    if (!target?.rect) {
      fail(
        `Could not locate ${id ? `id "${id}"` : `text "${text}"`}.`,
        'Run `npm run control -- snapshot --out /tmp/pappal.xml` and inspect the live hierarchy.',
      );
    }
    const x = Math.round((target.rect.left + target.rect.right) / 2);
    const y = Math.round((target.rect.top + target.rect.bottom) / 2);
    adb(['shell', 'input', 'tap', String(x), String(y)]);
    emit({ ok: true, locator: id ? { id } : { text }, x, y });
    break;
  }
  case 'click-xy': {
    const x = Number(argv[1]);
    const y = Number(argv[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      fail('click-xy requires numeric X and Y.', undefined, 2);
    }
    adb(['shell', 'input', 'tap', String(x), String(y)]);
    emit({
      ok: true,
      x,
      y,
      warning: 'Coordinate fallback used; prefer tap --id.',
    });
    break;
  }
  case 'type': {
    const text = argv[1];
    if (text === undefined) fail('type requires text.', undefined, 2);
    if (!/^[\x20-\x7e]*$/.test(text)) {
      fail(
        'type currently supports printable ASCII only.',
        'Use ARTEMIS for Unicode/IME text entry.',
        2,
      );
    }
    // `adb shell` joins argv and invokes the device shell. Escape every
    // non-alphanumeric character before it reaches `/system/bin/sh`; Android's
    // input command uses `%s` for spaces.
    const encoded = [...text]
      .map(character => {
        if (character === ' ') return '%s';
        return /[A-Za-z0-9_.-]/.test(character) ? character : `\\${character}`;
      })
      .join('');
    adb(['shell', 'input', 'text', encoded]);
    emit({ ok: true });
    break;
  }
  case 'press': {
    const key = argv[1];
    if (!key)
      fail(
        'press requires an Android keycode.',
        'Examples: BACK, HOME, ENTER.',
        2,
      );
    if (!/^(?:[A-Z][A-Z0-9_]{0,39}|[0-9]{1,3})$/.test(key)) {
      fail(
        'press accepts an uppercase Android key name or numeric keycode.',
        'Examples: BACK, KEYCODE_HOME, 66.',
        2,
      );
    }
    adb(['shell', 'input', 'keyevent', key]);
    emit({ ok: true, key });
    break;
  }
  case 'wait-settle': {
    const timeout = Number(option('timeout') ?? 10_000);
    const deadline = Date.now() + timeout;
    let previous = '';
    let stable = 0;
    while (Date.now() < deadline) {
      const hash = createHash('sha256').update(snapshot()).digest('hex');
      stable = hash === previous ? stable + 1 : 0;
      if (stable >= 2) {
        emit({ ok: true, settled: true, hash });
        process.exit(0);
      }
      previous = hash;
      sleep(250);
    }
    fail(
      'UI hierarchy did not settle before timeout.',
      'Inspect snapshot and logcat for a loop or blocking system UI.',
    );
    break;
  }
  case 'cleanup':
    adb(['shell', 'am', 'force-stop', PACKAGE]);
    emit({
      ok: true,
      stopped: PACKAGE,
      evidencePreserved: resolve(ROOT, 'artifacts/verification'),
    });
    break;
  case 'verify': {
    const tier = argv[1] ?? 'fast';
    const script = { fast: 'verify', full: 'verify:full', db: 'test:db' }[tier];
    if (!script) fail('verify tier must be fast, full, or db.', undefined, 2);
    const result = spawnSync('npm', ['run', script], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    process.exit(result.status ?? 1);
    break;
  }
  case 'help':
  default:
    emit(`Pappal control CLI

doctor                         Check host, auth prerequisites, and devices
info                           Report installed build and foreground activity
snapshot [--out FILE]          Dump the live accessibility/UI hierarchy
screenshot FILE                Capture a PNG from the selected device
launch                         Launch the app's main activity
open URI                       Open an app deep link
tap --id ID [--text LABEL]     Dynamic locator first; text fallback
click-xy X Y                   Explicit coordinate fallback
type TEXT                      Type into the focused field
press KEYCODE                  Send an Android key event
wait-settle [--timeout MS]     Wait for a stable UI hierarchy
cleanup                        Stop the exact app package; preserve evidence
verify fast|full|db            Run existing deterministic verification tiers

Device commands accept --serial SERIAL or ANDROID_SERIAL.
Use --json for machine-readable doctor/info/action output.`);
    if (command !== 'help') process.exitCode = 2;
}

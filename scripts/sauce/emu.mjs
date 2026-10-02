#!/usr/bin/env node
/**
 * Drive a Sauce Labs Android EMULATOR over Appium's W3C WebDriver API, so a
 * two-device E2E run does not need a person on the provider phone.
 *
 * Why an automated session and not Sauce Live: Live caps a free session at
 * 10 minutes and is driven by hand; an automated emulator session is a plain
 * HTTP API (https://docs.saucelabs.com/mobile-apps/automated-testing/appium/)
 * and runs until `idleTimeout` or `end`.
 *
 * Sign-in is the one step a person does. `login` fills the test phone number,
 * then asks for the code in the terminal of whoever runs it and types what
 * they enter; the code never appears in this repo, a log, or an agent's
 * context. Every other subcommand is safe to run unattended.
 *
 *   node scripts/sauce/emu.mjs start            # new session, app installed
 *   node scripts/sauce/emu.mjs login <phone10>  # run by a person: prompts for the code
 *   node scripts/sauce/emu.mjs ids              # visible elements: id / text / desc / bounds
 *   node scripts/sauce/emu.mjs tap id:<testID> | text:<text> | desc:<label> | xy:<x>,<y>
 *   node scripts/sauce/emu.mjs type id:<testID> <text...>
 *   node scripts/sauce/emu.mjs shot <file.png>
 *   node scripts/sauce/emu.mjs logcat [regex]
 *   node scripts/sauce/emu.mjs back | home | open | end
 *
 * Credentials, outside the repo: ~/.config/pappal/sauce.env (SAUCE_USERNAME /
 * SAUCE_ACCESS_KEY) or, with --cloud=bs, ~/.config/pappal/browserstack.env
 * (BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY). The session id lives in
 * /tmp/e2e/<cloud>-session.json. BrowserStack also has `upload <apk>` and `plan`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const APP_ID = 'com.companionchat';

/*
 * Two clouds behind one driver. `--cloud=bs` (or CLOUD=bs) selects BrowserStack
 * App Automate: real devices with Play services, a 90 s idle limit and a 2 h
 * cap (https://www.browserstack.com/docs/app-automate/appium/references/timeouts).
 * The default stays Sauce Labs emulators.
 */
const argv = process.argv.slice(2);
const cloudFlag = argv.find(a => a.startsWith('--cloud='));
const CLOUD =
  (cloudFlag ? cloudFlag.slice('--cloud='.length) : process.env.CLOUD) ||
  'sauce';
const CLOUDS = {
  sauce: {
    hub: 'https://ondemand.us-west-1.saucelabs.com/wd/hub',
    file: 'sauce.env',
    user: 'SAUCE_USERNAME',
    key: 'SAUCE_ACCESS_KEY',
  },
  bs: {
    hub: 'https://hub-cloud.browserstack.com/wd/hub',
    file: 'browserstack.env',
    user: 'BROWSERSTACK_USERNAME',
    key: 'BROWSERSTACK_ACCESS_KEY',
  },
};
const cloud = CLOUDS[CLOUD];
if (!cloud) throw new Error(`unknown cloud ${CLOUD}: use sauce or bs`);
const HUB = cloud.hub;
const STATE = `/tmp/e2e/${CLOUD}-session.json`;
const APP_STORAGE_NAME =
  process.env.SAUCE_APP_NAME ?? 'pappal-1.4.1-internal.apk';
/** BrowserStack app reference: the custom_id given at upload, so a re-upload needs no edit here. */
const BS_APP_ID = 'PappalProvider';

function loadCreds() {
  const file = join(homedir(), '.config/pappal', cloud.file);
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env[cloud.user] || !env[cloud.key]) {
    throw new Error(`${cloud.user} / ${cloud.key} missing in ${file}`);
  }
  return { user: env[cloud.user], key: env[cloud.key] };
}

const creds = loadCreds();
const auth =
  'Basic ' + Buffer.from(`${creds.user}:${creds.key}`).toString('base64');

async function wd(method, path, body) {
  const res = await fetch(HUB + path, {
    method,
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.value?.message ?? JSON.stringify(json).slice(0, 300);
    throw new Error(
      `${method} ${path.replace(/\/session\/[^/]+/, '/session/…')} → ${
        res.status
      }: ${msg}`,
    );
  }
  return json.value;
}

function sessionId() {
  if (!existsSync(STATE)) throw new Error('no session: run `start` first');
  return JSON.parse(readFileSync(STATE, 'utf8')).id;
}
const S = () => `/session/${sessionId()}`;

function locator(sel) {
  const i = sel.indexOf(':');
  const kind = sel.slice(0, i);
  const v = sel.slice(i + 1).replace(/"/g, '\\"');
  // React Native publishes `testID` as the Android resource-id.
  if (kind === 'id')
    return {
      using: '-android uiautomator',
      value: `new UiSelector().resourceId("${v}")`,
    };
  if (kind === 'text')
    return {
      using: '-android uiautomator',
      value: `new UiSelector().textContains("${v}")`,
    };
  if (kind === 'desc')
    return {
      using: '-android uiautomator',
      value: `new UiSelector().descriptionContains("${v}")`,
    };
  throw new Error(`selector must be id:, text:, desc: or xy: — got ${sel}`);
}

async function find(sel, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      const el = await wd('POST', `${S()}/element`, locator(sel));
      return Object.values(el)[0];
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw last;
}

async function tapXY(x, y) {
  await wd('POST', `${S()}/actions`, {
    actions: [
      {
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
}

async function tap(sel) {
  if (sel.startsWith('xy:')) {
    const [x, y] = sel.slice(3).split(',').map(Number);
    return tapXY(x, y);
  }
  await wd('POST', `${S()}/element/${await find(sel)}/click`, {});
}

async function typeInto(sel, text) {
  await wd('POST', `${S()}/element/${await find(sel)}/value`, { text });
}

function askHidden(question) {
  return new Promise(resolve => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl._writeToOutput = s => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function appStorageId() {
  const res = await fetch(
    `https://api.us-west-1.saucelabs.com/v1/storage/files?q=${encodeURIComponent(
      APP_STORAGE_NAME,
    )}`,
    { headers: { authorization: auth } },
  );
  const items = (await res.json()).items ?? [];
  const hit = items.find(i => i.name === APP_STORAGE_NAME);
  if (!hit) throw new Error(`no ${APP_STORAGE_NAME} in Sauce storage`);
  return hit.id;
}

async function startSession(deviceArg, versionArg) {
  const device = deviceArg ?? 'Google Pixel 6 Pro Emulator';
  const version = versionArg ?? '16.0';
  const capabilities =
    CLOUD === 'bs'
      ? {
          platformName: 'android',
          'appium:deviceName': deviceArg ?? 'Google Pixel 8',
          'appium:platformVersion': versionArg ?? '14.0',
          'appium:automationName': 'UiAutomator2',
          'appium:app': BS_APP_ID,
          'appium:autoGrantPermissions': true,
          'bstack:options': {
            projectName: 'Pappal E2E',
            buildName: 'provider-cloud',
            sessionName: 'two-device run',
            idleTimeout: 300,
            deviceLogs: true,
            video: true,
            interactiveDebugging: true,
          },
        }
      : {
          platformName: 'Android',
          'appium:deviceName': device,
          'appium:platformVersion': version,
          'appium:automationName': 'UiAutomator2',
          'appium:app': `storage:${await appStorageId()}`,
          'appium:autoGrantPermissions': true,
          'appium:newCommandTimeout': 900,
          'sauce:options': {
            name: 'pappal e2e — provider emulator',
            idleTimeout: 1000,
            maxDuration: 3600,
          },
        };
  const value = await wd('POST', '/session', {
    capabilities: { alwaysMatch: capabilities },
  });
  mkdirSync('/tmp/e2e', { recursive: true });
  writeFileSync(
    STATE,
    JSON.stringify({
      id: value.sessionId,
      device: capabilities['appium:deviceName'],
      version: capabilities['appium:platformVersion'],
    }),
  );
  console.log(
    `session started on ${capabilities['appium:deviceName']} ${capabilities['appium:platformVersion']} (${CLOUD})`,
  );
}

/** A live session, or a fresh one: a person running `login` should not race the idle timeout. */
async function ensureSession() {
  try {
    // Any 404, or a cloud's "finished/terminated/not started" wording, means
    // the saved session is gone; other errors (e.g. no URL in a native
    // context) mean it is alive.
    await wd('GET', `${S()}/url`).catch(async e => {
      if (
        /→ 404|finished|terminated|not started|not found|no session/i.test(
          e.message,
        )
      )
        throw e;
    });
  } catch {
    await startSession();
    await new Promise(r => setTimeout(r, 8000));
    await wd('POST', `${S()}/appium/device/activate_app`, { appId: APP_ID });
    await new Promise(r => setTimeout(r, 8000));
  }
}

const [cmd, ...args] = argv.filter(a => !a.startsWith('--cloud='));

switch (cmd) {
  case 'start':
    await startSession(args[0], args[1]);
    break;
  case 'login': {
    const phone = args[0];
    if (!/^\d{10}$/.test(phone ?? ''))
      throw new Error('usage: login <10-digit phone>');
    await ensureSession();
    try {
      await tap('id:welcome-continue');
    } catch {
      /* already past the welcome */
    }
    await tap('id:onboard-use-phone');
    await typeInto('id:onboard-phone', phone);
    await tap('id:onboard-send-code');
    await find('id:onboard-code', 20000);
    // A person may take longer than the cloud's idle limit (90 s on
    // BrowserStack) to read the code, so keep the session busy meanwhile.
    const keepAlive = setInterval(() => {
      void wd('GET', `${S()}/source`).catch(() => {});
    }, 45_000);
    const code = await askHidden('Code: ').finally(() =>
      clearInterval(keepAlive),
    );
    if (!/^\d{6}$/.test(code)) throw new Error('the code is 6 digits');
    await typeInto('id:onboard-code', code);
    console.log('code entered; the app verifies on the sixth digit');
    break;
  }
  case 'ids': {
    const xml = await wd('GET', `${S()}/source`);
    for (const m of xml.matchAll(/<[^>]+>/g)) {
      const n = m[0];
      const get = k => (n.match(new RegExp(`${k}="([^"]*)"`)) ?? [])[1] ?? '';
      const id = get('resource-id'),
        text = get('text'),
        desc = get('content-desc'),
        b = get('bounds');
      if ((id || text || desc) && b && get('displayed') !== 'false') {
        console.log(
          [
            id && `id:${id}`,
            text && `text:${JSON.stringify(text.slice(0, 50))}`,
            desc && `desc:${JSON.stringify(desc.slice(0, 70))}`,
            b,
          ]
            .filter(Boolean)
            .join('  '),
        );
      }
    }
    break;
  }
  case 'waittap': {
    // Poll the page source and tap the first element matching any selector,
    // by its bounds: a ring lasts 30 s, and a failed element lookup can wait
    // longer than that. Usage: waittap <seconds> <sel> [<sel>...]
    const until = Date.now() + Number(args[0]) * 1000;
    const sels = args.slice(1).map(sel => {
      const i = sel.indexOf(':');
      return { kind: sel.slice(0, i), v: sel.slice(i + 1) };
    });
    let done = false;
    while (!done && Date.now() < until) {
      const xml = await wd('GET', `${S()}/source`);
      for (const m of xml.matchAll(/<[^>]+>/g)) {
        const n = m[0];
        const get = k => (n.match(new RegExp(`${k}="([^"]*)"`)) ?? [])[1] ?? '';
        const hit = sels.find(
          ({ kind, v }) =>
            (kind === 'id' && get('resource-id') === v) ||
            (kind === 'text' && get('text').includes(v)) ||
            (kind === 'desc' && get('content-desc').includes(v)),
        );
        const b = get('bounds').match(/\d+/g);
        if (hit && b) {
          const [x1, y1, x2, y2] = b.map(Number);
          await tapXY(Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2));
          console.log(`tapped ${hit.kind}:${hit.v}`);
          done = true;
          break;
        }
      }
    }
    if (!done) {
      console.log('not found');
      process.exitCode = 2;
    }
    break;
  }
  case 'tap':
    await tap(args[0]);
    console.log('tapped');
    break;
  case 'type':
    await typeInto(args[0], args.slice(1).join(' '));
    console.log('typed');
    break;
  case 'shot': {
    const png = await wd('GET', `${S()}/screenshot`);
    writeFileSync(args[0] ?? '/tmp/e2e/emu.png', Buffer.from(png, 'base64'));
    console.log('saved');
    break;
  }
  case 'rotate':
    await wd('POST', `${S()}/orientation`, {
      orientation: (args[0] ?? 'portrait').toUpperCase(),
    });
    console.log('rotated');
    break;
  case 'back':
    await wd('POST', `${S()}/back`, {});
    console.log('back');
    break;
  case 'home':
    await wd('POST', `${S()}/appium/device/press_keycode`, { keycode: 3 });
    console.log('home');
    break;
  case 'shade':
    await wd('POST', `${S()}/appium/device/open_notifications`, {});
    console.log('shade open');
    break;
  case 'kill':
    await wd('POST', `${S()}/appium/device/terminate_app`, { appId: APP_ID });
    console.log('killed');
    break;
  case 'open':
    await wd('POST', `${S()}/appium/device/activate_app`, { appId: APP_ID });
    console.log('opened');
    break;
  case 'logcat': {
    const entries = await wd('POST', `${S()}/se/log`, { type: 'logcat' });
    const pat = args[0] ? new RegExp(args[0]) : null;
    for (const e of entries)
      if (!pat || pat.test(e.message)) console.log(e.message);
    break;
  }
  case 'upload': {
    if (CLOUD !== 'bs')
      throw new Error('upload is for --cloud=bs; Sauce uses its storage API');
    const form = new FormData();
    form.append('file', new Blob([readFileSync(args[0])]), 'app.apk');
    form.append('data', JSON.stringify({ custom_id: BS_APP_ID }));
    const res = await fetch(
      'https://api-cloud.browserstack.com/app-automate/upload',
      {
        method: 'POST',
        headers: { authorization: auth },
        body: form,
      },
    );
    const json = await res.json();
    if (!res.ok)
      throw new Error(
        `upload → ${res.status}: ${JSON.stringify(json).slice(0, 200)}`,
      );
    console.log(`uploaded as ${json.custom_id}`);
    break;
  }
  case 'plan': {
    if (CLOUD !== 'bs') throw new Error('plan is for --cloud=bs');
    const res = await fetch(
      'https://api-cloud.browserstack.com/app-automate/plan.json',
      { headers: { authorization: auth } },
    );
    console.log(JSON.stringify(await res.json()));
    break;
  }
  case 'end':
    await wd('DELETE', S());
    console.log('session ended');
    break;
  default:
    console.log(
      'usage: start | login <phone> | ids | tap <sel> | type <sel> <text> | shot <file> | back | home | open | end',
    );
    process.exitCode = 1;
}

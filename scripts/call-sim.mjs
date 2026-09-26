#!/usr/bin/env node
/**
 * Production-path two-phone call orchestrator.
 *
 * It never runs the three SDKs simultaneously: each 3-minute call is one arm
 * from a deterministic Latin-square schedule. Both devices use the normal
 * start_call -> FCM/Realtime answer -> leases -> end_call path.
 *
 * Required environment:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   CALL_SIM_CONVERSATION_ID, CALL_SIM_CALLER_SERIAL, CALL_SIM_CALLEE_SERIAL
 *
 * The two physical devices must already be signed in as the participants in
 * CALL_SIM_CONVERSATION_ID. The harness mints a short-lived caller session only
 * to invoke the allowlisted assignment RPC; it never writes auth tokens to disk.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_ID = 'com.companionchat';
const OUT = join(ROOT, 'artifacts', 'call-sim');
const BACKENDS = ['agora'];
const LATIN = [['agora']];
const VALID_SCENARIOS = new Set([
  'wifi-baseline',
  'airtel-jio',
  'mixed',
  'wifi-cell-handoff',
  'netem-150-2',
  'netem-300-5-outage',
]);

const env = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const arg = (name, fallback) =>
  process.argv
    .find(value => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=') ?? fallback;
const scenario = arg('scenario', 'wifi-baseline');
const runCount = Number(arg('runs', '1'));
const durationSeconds = Number(arg('duration', '180'));
const requestedBackend = arg('backend', 'latin');
const requestedMedium = arg('medium', 'video');
const requestedResolution = arg('resolution', 'hd');
const killedApp = process.argv.includes('--killed-app');
if (!VALID_SCENARIOS.has(scenario))
  throw new Error(`Unknown scenario: ${scenario}`);
if (!Number.isInteger(runCount) || runCount < 1)
  throw new Error('runs must be a positive integer');
if (!Number.isFinite(durationSeconds) || durationSeconds < 30) {
  throw new Error('duration must be at least 30 seconds');
}
if (requestedBackend !== 'latin' && !BACKENDS.includes(requestedBackend)) {
  throw new Error(`Unknown backend: ${requestedBackend}`);
}
if (requestedMedium !== 'voice' && requestedMedium !== 'video') {
  throw new Error('medium must be voice or video');
}
if (requestedResolution !== 'hd' && requestedResolution !== 'fhd') {
  throw new Error('resolution must be hd or fhd');
}
// Voice has no camera profile; keep the arg legal so matrix loops stay uniform,
// but do not pretend FHD voice is a distinct arm.
const resolution = requestedMedium === 'voice' ? 'hd' : requestedResolution;

const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const CONVERSATION_ID = env('CALL_SIM_CONVERSATION_ID');
const callerSerial = env('CALL_SIM_CALLER_SERIAL');
const calleeSerial = env('CALL_SIM_CALLEE_SERIAL');
const experimentId = arg('experiment', 'physical-v1');
// Comfortably above a full matrix at the video rate, so no run is ever the one
// that runs the member dry mid-flight.
const BALANCE_FLOOR = 20_000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${binary} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`,
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function resolveAdb() {
  if (process.env.ADB && existsSync(process.env.ADB)) return process.env.ADB;
  const sdk = readFileSync(
    join(ROOT, 'android', 'local.properties'),
    'utf8',
  ).match(/^sdk\.dir=(.+)$/m)?.[1];
  const candidates = [
    sdk ? join(sdk, 'platform-tools', 'adb') : '',
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
  ];
  return candidates.find(path => path && existsSync(path)) ?? 'adb';
}
const ADB = resolveAdb();
const UI_DUMP_PATH = '/sdcard/call-sim-ui.xml';
const adb = (serial, args, options) =>
  command(ADB, ['-s', serial, ...args], options);

function deviceProp(serial, name) {
  return adb(serial, ['shell', 'getprop', name]).trim();
}

function batteryPercent(serial) {
  const raw = adb(serial, ['shell', 'dumpsys', 'battery']);
  return Number(/\blevel:\s*(\d+)/.exec(raw)?.[1] ?? -1);
}

function thermalStatus(serial) {
  const raw = adb(serial, ['shell', 'dumpsys', 'thermalservice'], {
    allowFailure: true,
  });
  return Number(/mStatus=(\d+)/.exec(raw)?.[1] ?? 0);
}

function assertPhysicalReady(serial) {
  const state = adb(serial, ['get-state']).trim();
  if (state !== 'device') throw new Error(`${serial} is not online`);
  if (deviceProp(serial, 'ro.kernel.qemu') === '1') {
    throw new Error(
      `${serial} is an emulator; this matrix requires physical devices`,
    );
  }
  const battery = batteryPercent(serial);
  if (battery < 20)
    throw new Error(`${serial} battery is ${battery}%; require at least 20%`);
  const thermal = thermalStatus(serial);
  if (thermal >= 4)
    throw new Error(`${serial} thermal status ${thermal}; cool before running`);
}

/**
 * `uiautomator dump` fails with "could not get idle state" while anything is
 * animating, and every waiting phase of CallScreen runs CallingDots forever, so
 * the incoming screen can never be read. Zeroing the animation scales is what
 * Android's UI Automator testing setup asks for, and it doubles as the signal
 * behind `useReducedMotion`, which makes those components render statically.
 * https://developer.android.com/training/testing/other-components/ui-automator
 */
function stillTheAnimations(serial) {
  for (const scale of [
    'window_animation_scale',
    'transition_animation_scale',
    'animator_duration_scale',
  ]) {
    adb(serial, ['shell', 'settings', 'put', 'global', scale, '0'], {
      allowFailure: true,
    });
  }
}

/**
 * Keep the caller-ID app off the top of the screen.
 *
 * A real spam call arrived mid-run and Truecaller's after-call screen covered
 * the app, so the flow failed on `call-end is visible` while the call itself was
 * fine. Do Not Disturb suppresses the interruption and force-stopping Truecaller
 * removes the overlay that outlives it. Neither is uninstalled: this is the
 * owner's daily phone, so the change is a setting the run can leave behind.
 */
function silenceInterruptions(serial) {
  adb(serial, ['shell', 'settings', 'put', 'global', 'zen_mode', '1'], {
    allowFailure: true,
  });
  adb(serial, ['shell', 'am', 'force-stop', 'com.truecaller'], {
    allowFailure: true,
  });
}

function grantCallPermissions(serial) {
  for (const permission of [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.POST_NOTIFICATIONS',
  ]) {
    adb(serial, ['shell', 'pm', 'grant', APP_ID, permission], {
      allowFailure: true,
    });
  }
}

function pullLogcat(serial, dest) {
  const fd = openSync(dest, 'w');
  try {
    spawnSync(ADB, ['-s', serial, 'logcat', '-d', '-v', 'threadtime'], {
      cwd: ROOT,
      stdio: ['ignore', fd, 'ignore'],
    });
  } finally {
    closeSync(fd);
  }
}

function maestro(serial, flow, extraEnv = {}) {
  const args = ['test', '--device', serial, join(ROOT, '.maestro', flow)];
  const result = spawnSync('maestro', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0)
    throw new Error(`Maestro ${flow} failed on ${serial}`);
}

function maestroAsync(serial, flow, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'maestro',
      ['test', '--device', serial, join(ROOT, '.maestro', flow)],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...extraEnv },
      },
    );
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Maestro ${flow} failed on ${serial}`));
    });
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Both device flows start before either is awaited. Attaching the handler up
 * front keeps an early rejection from tripping Node's unhandled-rejection kill.
 */
const settled = promise =>
  promise.then(
    () => null,
    error => error,
  );

async function poll(label, fn, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function callerToken(userId) {
  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  if (userError || !email) {
    throw new Error(
      'Caller test account must have an email for ephemeral harness auth',
    );
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !link.properties?.hashed_token)
    throw new Error('Could not mint harness auth');
  const { data, error } = await anonymous.auth.verifyOtp({
    type: 'email',
    token_hash: link.properties.hashed_token,
  });
  if (error || !data.session) throw new Error('Could not verify harness auth');
  return data.session.access_token;
}

async function loadParticipants() {
  const { data, error } = await admin
    .from('conversations')
    .select('member_id,provider_id')
    .eq('id', CONVERSATION_ID)
    .single();
  if (error || !data) throw new Error('Simulation conversation does not exist');
  return { callerId: data.member_id, calleeId: data.provider_id };
}

/**
 * Keep the member solvent for the whole matrix.
 *
 * Every run bills real tokens, so a matrix that starts with enough balance can
 * still run out partway through. `start_call` then answers INSUFFICIENT_BALANCE
 * and CallScreen opens the recharge sheet instead of dialling — which surfaces
 * only as "call-end is not visible", blaming the flow for a funding problem. A
 * floor checked before each run keeps the failure from being possible at all.
 */
async function ensureBalance(memberId) {
  const { data, error } = await admin
    .from('profiles')
    .select('promo_balance,purchased_balance')
    .eq('id', memberId)
    .single();
  if (error || !data) throw new Error('Cannot read simulation member balance');
  if (data.promo_balance + data.purchased_balance >= BALANCE_FLOOR) return;
  // The buckets are the money; `token_balance` is a mirror the 028 trigger
  // recomputes only when a bucket changes, so writing it funds nothing and
  // `deduct_tokens` still raises P0003. Promo is the right bucket: it is where
  // 028 put every pre-payments balance, and these tokens were never bought.
  const { error: topUp } = await admin
    .from('profiles')
    .update({ promo_balance: BALANCE_FLOOR })
    .eq('id', memberId);
  if (topUp)
    throw new Error(`Cannot top up simulation member: ${topUp.message}`);
}

/**
 * Kill leftover ringing/active calls on the simulation conversation.
 *
 * An aborted matrix leaves a call row in `active` with no phones attached.
 * `start_call` then refuses the next dial, CallScreen exits immediately, and
 * Maestro reports "call-end is not visible" while sitting on Home — which is
 * how the resume after the remote-video UI fix burned two arms.
 */
async function clearStaleCalls() {
  const now = new Date().toISOString();
  const { error } = await admin
    .from('calls')
    .update({ status: 'ended', end_reason: 'hangup', ended_at: now })
    .eq('conversation_id', CONVERSATION_ID)
    .in('status', ['ringing', 'active']);
  if (error) throw new Error(`Cannot clear stale calls: ${error.message}`);
  await admin
    .from('paid_sessions')
    .update({ status: 'ended', end_reason: 'system', ended_at: now })
    .eq('conversation_id', CONVERSATION_ID)
    .in('status', ['active', 'pending_leases']);
}

async function scheduleBackend(accessToken, backend, runId) {
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await caller.rpc('set_next_call_media_backend', {
    p_conversation_id: CONVERSATION_ID,
    p_backend: backend,
    p_experiment_id: experimentId,
    p_run_id: runId,
  });
  if (error) throw new Error(`Assignment rejected: ${error.message}`);
}

async function ensureAllowlisted(callerId, calleeId) {
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from('call_media_test_allowlist').upsert([
    { user_id: callerId, expires_at },
    { user_id: calleeId, expires_at },
  ]);
  if (error)
    throw new Error(`Could not allowlist test users: ${error.message}`);
}

function setCaptureProfile(serial, nextResolution) {
  // Opens the harness-only deep link that writes MMKV before the peer chat is
  // launched. Both phones must agree: the callee enables video from the same
  // profile the caller negotiated against.
  adb(serial, [
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    `${APP_ID}/.MainActivity`,
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `companionchat://call-sim?resolution=${nextResolution}`,
  ]);
}

function launchPeer(serial, peerId) {
  // Explicit component, matching Conversations.peerIntent. The only public VIEW
  // filter is auth-callback; an implicit companionchat://peer intent cannot
  // resolve, by design, so other apps cannot open a conversation by id.
  // https://developer.android.com/training/app-links/deep-linking#using-adb
  adb(serial, [
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    `${APP_ID}/.MainActivity`,
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `companionchat://peer/${peerId}`,
  ]);
}

function startPerfetto(serial, runId) {
  const remote = `/data/misc/perfetto-traces/pappal-${runId}.perfetto-trace`;
  const child = spawn(
    ADB,
    [
      '-s',
      serial,
      'shell',
      'perfetto',
      '-o',
      remote,
      '-t',
      `${durationSeconds + 45}s`,
      'sched',
      'freq',
      'idle',
      'am',
      'wm',
      'gfx',
      'view',
      'binder_driver',
      'hal',
      'camera',
      'audio',
      'network',
    ],
    { cwd: ROOT, stdio: 'ignore' },
  );
  return { child, remote };
}

function stopAndPullPerfetto(serial, trace, destination) {
  trace.child.kill('SIGINT');
  adb(serial, ['pull', trace.remote, destination], { allowFailure: true });
  adb(serial, ['shell', 'rm', '-f', trace.remote], { allowFailure: true });
}

function setRadios(serial, wifi, data) {
  adb(serial, ['shell', 'svc', 'wifi', wifi ? 'enable' : 'disable']);
  adb(serial, ['shell', 'svc', 'data', data ? 'enable' : 'disable']);
}

function gatewayNetem(latencyMs, lossPercent) {
  const host = env('CALL_SIM_GATEWAY_SSH');
  const iface = env('CALL_SIM_GATEWAY_INTERFACE');
  command('ssh', [
    host,
    'sudo',
    'tc',
    'qdisc',
    'replace',
    'dev',
    iface,
    'root',
    'netem',
    'delay',
    `${latencyMs}ms`,
    'loss',
    `${lossPercent}%`,
  ]);
  return () =>
    command('ssh', [host, 'sudo', 'tc', 'qdisc', 'del', 'dev', iface, 'root'], {
      allowFailure: true,
    });
}

async function executeNetworkEvent(runCalleeSerial) {
  if (scenario === 'wifi-cell-handoff') {
    await delay(60_000);
    setRadios(runCalleeSerial, false, true);
    return () => setRadios(runCalleeSerial, true, true);
  }
  if (scenario === 'netem-150-2') {
    const reset = gatewayNetem(150, 2);
    return reset;
  }
  if (scenario === 'netem-300-5-outage') {
    const reset = gatewayNetem(300, 5);
    await delay(60_000);
    setRadios(runCalleeSerial, false, false);
    await delay(5_000);
    setRadios(runCalleeSerial, true, true);
    return reset;
  }
  return () => undefined;
}

/**
 * MIUI refuses Maestro's driver APK with INSTALL_FAILED_USER_RESTRICTED: its
 * test-APK install is gated behind "USB debugging (Security settings)", which
 * needs a Mi account. `uiautomator dump` and `input tap` are not gated, so the
 * callee is driven with those directly rather than requiring that toggle.
 */
function uiHierarchy(serial) {
  // Dumping to /dev/tty is killed mid-write on the Redmi; a file plus `cat`
  // survives, and MIUI's ThemeCompatibility stack trace on stderr is noise.
  // --compressed drops the non-interactive nodes. On the Redmi a full dump of a
  // populated chat takes upwards of ten seconds, which is a third of the ring
  // window spent on one poll attempt.
  adb(serial, ['shell', 'uiautomator', 'dump', '--compressed', UI_DUMP_PATH], {
    allowFailure: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return adb(serial, ['shell', 'cat', UI_DUMP_PATH], {
    allowFailure: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function nodeCentre(xml, selector) {
  const match = new RegExp(
    `${selector}[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  ).exec(xml);
  if (!match) return null;
  return {
    x: Math.round((Number(match[1]) + Number(match[3])) / 2),
    y: Math.round((Number(match[2]) + Number(match[4])) / 2),
  };
}

/** True once the answer has landed, whoever tapped it. */
async function callAnswered(runId) {
  const { data } = await admin
    .from('calls')
    .select('status')
    .eq('media_run_id', runId)
    .maybeSingle();
  return data?.status === 'active';
}

async function answerOnCallee(serial, runId) {
  await poll(
    'callee accept button',
    async () => {
      if (await callAnswered(runId)) return 'already-answered';
      const xml = uiHierarchy(serial);
      const accept = nodeCentre(xml, 'resource-id="call-accept"');
      if (!accept) return null;
      adb(serial, [
        'shell',
        'input',
        'tap',
        String(accept.x),
        String(accept.y),
      ]);
      return accept;
    },
    120_000,
  );
  // The ledger, not the button, is the answer's proof: a hand-tapped accept
  // leaves no button to observe.
  await poll('callee answer in ledger', () => callAnswered(runId), 45_000);
}

function tapNotificationAnswer(serial) {
  adb(serial, ['shell', 'cmd', 'statusbar', 'expand-notifications']);
  const xml = adb(serial, ['exec-out', 'uiautomator', 'dump', '/dev/tty']);
  const match =
    /text="Answer"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  if (!match) throw new Error('Killed-app CallStyle Answer action not found');
  const x = (Number(match[1]) + Number(match[3])) / 2;
  const y = (Number(match[2]) + Number(match[4])) / 2;
  adb(serial, [
    'shell',
    'input',
    'tap',
    String(Math.round(x)),
    String(Math.round(y)),
  ]);
}

async function ledger(callId) {
  const { data: call, error: callError } = await admin
    .from('calls')
    .select(
      'status,media_backend,media_experiment_id,media_run_id,ended_at,end_reason',
    )
    .eq('id', callId)
    .single();
  if (callError)
    throw new Error(`Call ledger query failed: ${callError.message}`);
  const { data: session, error: sessionError } = await admin
    .from('paid_sessions')
    .select(
      'status,minutes_billed,tokens_debited,started_at,ended_at,end_reason',
    )
    .eq('call_id', callId)
    .maybeSingle();
  if (sessionError)
    throw new Error(`Session ledger query failed: ${sessionError.message}`);
  return { call, session };
}

function backendFor(index) {
  if (requestedBackend !== 'latin') return requestedBackend;
  const square = LATIN[index % LATIN.length];
  return square[Math.floor(index / LATIN.length) % square.length];
}

mkdirSync(OUT, { recursive: true });
assertPhysicalReady(callerSerial);
assertPhysicalReady(calleeSerial);
grantCallPermissions(callerSerial);
grantCallPermissions(calleeSerial);
stillTheAnimations(callerSerial);
stillTheAnimations(calleeSerial);
silenceInterruptions(callerSerial);
silenceInterruptions(calleeSerial);
const participants = await loadParticipants();
await ensureAllowlisted(participants.callerId, participants.calleeId);
// Funded before the app is started, not after. The store caches the balance at
// launch, and a top-up applied to a running app leaves it billing against the
// old number: a 32-token cache against the 35/min video rate ended a healthy
// session as `balance_exhausted` four seconds in, having debited nothing.
await ensureBalance(participants.callerId);
// The scales are read at process start, so a device configured mid-session
// keeps animating until the app is restarted.
adb(callerSerial, ['shell', 'am', 'force-stop', APP_ID]);
adb(calleeSerial, ['shell', 'am', 'force-stop', APP_ID]);

for (let index = 0; index < runCount; index += 1) {
  // Opt-in: odd runs swapping to provider-as-caller fail on this pair because
  // launchPeer does not land the provider on a chat with a visible call-video.
  const rotated = process.env.CALL_SIM_ROTATE === '1' && index % 2 === 1;
  const runCallerSerial = rotated ? calleeSerial : callerSerial;
  const runCalleeSerial = rotated ? callerSerial : calleeSerial;
  const runCallerId = rotated ? participants.calleeId : participants.callerId;
  const runCalleeId = rotated ? participants.callerId : participants.calleeId;
  const backend = backendFor(index);
  const runId = randomUUID();
  const runDir = join(OUT, runId);
  mkdirSync(runDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startBattery = {
    caller: batteryPercent(runCallerSerial),
    callee: batteryPercent(runCalleeSerial),
  };
  // Mint per run: long matrices and thermal cooldowns can exceed Supabase's
  // one-hour access-token lifetime.
  const runCallerToken = await callerToken(runCallerId);
  const runCallerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${runCallerToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let callId;
  let resetNetwork = () => undefined;
  let outcome = 'failed';
  let failure = null;
  let callerMaestro = Promise.resolve(null);

  adb(runCallerSerial, ['logcat', '-c']);
  adb(runCalleeSerial, ['logcat', '-c']);
  const callerTrace = startPerfetto(runCallerSerial, `${runId}-caller`);
  const calleeTrace = startPerfetto(runCalleeSerial, `${runId}-callee`);

  try {
    await scheduleBackend(runCallerToken, backend, runId);
    if (killedApp) {
      adb(runCalleeSerial, ['shell', 'am', 'force-stop', APP_ID]);
    } else {
      adb(runCalleeSerial, ['shell', 'monkey', '-p', APP_ID, '1']);
    }
    // Re-applied per run: an overlay only has to appear once, in the seconds
    // between launching the chat and asserting the call screen, to fail a run.
    silenceInterruptions(runCallerSerial);
    silenceInterruptions(runCalleeSerial);
    await clearStaleCalls();
    await ensureBalance(runCallerId);
    // Profile before peer: MMKV is written by the call-sim deep link, and both
    // phones must share it before either enables the camera.
    if (requestedMedium === 'video') {
      setCaptureProfile(runCallerSerial, resolution);
      setCaptureProfile(runCalleeSerial, resolution);
    }
    launchPeer(runCallerSerial, runCalleeId);
    // migration 011 expires a ringing call after 30s. Maestro spends longer
    // than that starting its on-device driver, so running the two flows in
    // sequence answers a call that has already gone to 'unanswered'. Both
    // flows start together and each waits for its own screen.
    const callerFlow =
      requestedMedium === 'voice'
        ? 'call-sim-caller-voice.yaml'
        : 'call-sim-caller.yaml';
    callerMaestro = settled(maestroAsync(runCallerSerial, callerFlow));
    const calleeAnswer = killedApp
      ? null
      : settled(answerOnCallee(runCalleeSerial, runId));

    // Raced against the caller flow rather than simply awaited. A caller that
    // never reaches start_call produces no row, so the poll would burn its full
    // timeout and report "no ringing call row" — hiding the Maestro failure that
    // actually explains it.
    const call = await Promise.race([
      poll(
        'ringing call row',
        async () => {
          const { data } = await admin
            .from('calls')
            .select('id,media_backend,media_run_id')
            .eq('conversation_id', CONVERSATION_ID)
            .eq('media_run_id', runId)
            .maybeSingle();
          return data;
        },
        120_000,
      ),
      callerMaestro.then(error => {
        if (error) throw error;
        // Succeeded: let the poll decide the outcome.
        return new Promise(() => {});
      }),
    ]);
    callId = call.id;
    if (call.media_backend !== backend || call.media_run_id !== runId) {
      throw new Error('Server assignment differs from scheduled arm');
    }

    if (killedApp) {
      await delay(2_000);
      tapNotificationAnswer(runCalleeSerial);
      await maestroAsync(
        runCalleeSerial,
        'call-sim-callee-after-notification.yaml',
      );
    } else {
      const answerError = await calleeAnswer;
      if (answerError) throw answerError;
    }
    const callerError = await callerMaestro;
    if (callerError) throw callerError;

    await poll(
      'active paid session',
      async () => {
        const snapshot = await ledger(callId);
        return snapshot.session?.status === 'active' ? snapshot : null;
      },
      45_000,
    );

    resetNetwork = await executeNetworkEvent(runCalleeSerial);
    const elapsed = (Date.now() - Date.parse(startedAt)) / 1000;
    await delay(Math.max(0, durationSeconds - elapsed) * 1000);
    maestro(runCallerSerial, 'call-sim-end.yaml');
    await poll('ended call ledger', async () => {
      const value = await ledger(callId);
      return ['ended', 'failed', 'missed', 'declined'].includes(
        value.call.status,
      )
        ? value
        : null;
    });
    outcome = 'completed';
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (callId) {
      await runCallerClient.rpc('end_call', {
        p_call_id: callId,
        p_reason: 'media_failed',
      });
    }
  } finally {
    await callerMaestro;
    resetNetwork();
    setRadios(callerSerial, true, true);
    setRadios(calleeSerial, true, true);
    stopAndPullPerfetto(
      runCallerSerial,
      callerTrace,
      join(runDir, 'caller.perfetto-trace'),
    );
    stopAndPullPerfetto(
      runCalleeSerial,
      calleeTrace,
      join(runDir, 'callee.perfetto-trace'),
    );
    pullLogcat(runCallerSerial, join(runDir, 'caller.logcat.txt'));
    pullLogcat(runCalleeSerial, join(runDir, 'callee.logcat.txt'));
  }

  const endBattery = {
    caller: batteryPercent(runCallerSerial),
    callee: batteryPercent(runCalleeSerial),
  };
  const evidence = callId ? await ledger(callId) : null;
  const record = {
    runId,
    callId: callId ?? null,
    backend,
    medium: requestedMedium,
    resolution: requestedMedium === 'video' ? resolution : null,
    experimentId,
    scenario,
    roleRotation: rotated ? 'provider-caller' : 'member-caller',
    startedAt,
    endedAt: new Date().toISOString(),
    durationTargetSeconds: durationSeconds,
    outcome,
    failure,
    devices: {
      caller: {
        model: deviceProp(runCallerSerial, 'ro.product.model'),
        api: Number(deviceProp(runCallerSerial, 'ro.build.version.sdk')),
      },
      callee: {
        model: deviceProp(runCalleeSerial, 'ro.product.model'),
        api: Number(deviceProp(runCalleeSerial, 'ro.build.version.sdk')),
      },
    },
    battery: { start: startBattery, end: endBattery },
    ledger: evidence,
  };
  writeFileSync(
    join(runDir, 'run.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  appendFileSync(join(OUT, 'runs.ndjson'), `${JSON.stringify(record)}\n`);
  console.log(
    `${outcome}: ${backend} ${requestedMedium}` +
      `${requestedMedium === 'video' ? `/${resolution}` : ''} ` +
      `${scenario} ${runId}${failure ? ` — ${failure}` : ''}`,
  );

  if (
    thermalStatus(runCallerSerial) >= 4 ||
    thermalStatus(runCalleeSerial) >= 4
  ) {
    console.log('Thermal status elevated; cooling for 5 minutes.');
    await delay(5 * 60 * 1000);
  } else if (index + 1 < runCount) {
    await delay(30_000);
  }
}

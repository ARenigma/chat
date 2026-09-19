import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('V2 device gates', () => {
  const benchmarkPath =
    'android/baselineprofile/src/main/java/com/companionchat/baselineprofile/FeelBenchmark.kt';

  it('benchmarks only non-mutating V2 keyboard, composer, and page-down journeys', () => {
    const benchmark = read(benchmarkPath);

    for (const journey of [
      'imeOpenCloseFrames',
      'repeatedInteractiveRetractFrames',
      'multilineComposerGrowthFrames',
      'pageDownJumpFrames',
      'composerControlSwapFrames',
      'scrolledUpAnchorPreservationFrames',
    ]) {
      expect(benchmark).toContain(`fun ${journey}()`);
    }

    for (const testID of [
      'chat-v2-screen',
      'chat-v2-list',
      'chat-v2-input',
      'chat-v2-send',
      'chat-v2-page-down',
      'chat-v2-page-down-visible',
      'chat-v2-dock',
    ]) {
      expect(benchmark).toMatch(
        new RegExp(`(?:By\\.res|requireObject|findObject)\\("${testID}"\\)`),
      );
    }

    expect(benchmark).not.toContain('emojiSwapFrames');
    expect(benchmark).not.toContain('attachOpenFrames');
    expect(benchmark).not.toContain('composer-emoji');
    expect(benchmark).not.toContain('composer-attach');
    expect(benchmark).not.toContain('emoji-panel');
    expect(benchmark).not.toContain('attach-panel');
    expect(benchmark).not.toContain('sendAtBottomFrames');
    expect(benchmark).not.toMatch(/requireObject\("chat-v2-send"\)\.click/);
  });

  it('validates a strict UUID before shell interpolation and opens through an internal capability', () => {
    const benchmark = read(benchmarkPath);
    const gradle = read('android/app/build.gradle');
    const nativeModule = read(
      'android/app/src/main/java/com/companionchat/WindowChromeModule.kt',
    );
    const app = read('App.tsx');

    expect(benchmark).toContain('companionchat://chat-v2/$providerId');
    expect(benchmark).toContain('PROVIDER_ID.matches(providerId)');
    expect(benchmark.indexOf('PROVIDER_ID.matches(providerId)')).toBeLessThan(
      benchmark.indexOf('companionchat://chat-v2/$providerId'),
    );
    expect(benchmark).toContain('setupBlock = {');
    expect(benchmark).toContain('openV2ChatForSetup()');
    expect(benchmark).toContain('killProcess()');
    expect(gradle).toContain(
      'buildConfigField "boolean", "ALLOW_BENCHMARK_ROUTES", "false"',
    );
    expect(gradle).toContain(
      'buildConfigField "boolean", "ALLOW_BENCHMARK_ROUTES", "true"',
    );
    expect(nativeModule).toContain(
      '"allowBenchmarkRoutes" to BuildConfig.ALLOW_BENCHMARK_ROUTES',
    );
    expect(app).toContain('allowBenchmarkRoutes');
    expect(app).toMatch(
      /parseChatV2Url\(\s*url,\s*__DEV__ \|\| allowBenchmarkRoutes,\s*\)/,
    );
  });

  it('marks the first post-force-stop V2 launch read-only before app startup', () => {
    const benchmark = read(benchmarkPath);
    const activity = read(
      'android/app/src/main/java/com/companionchat/MainActivity.kt',
    );
    const nativeModule = read(
      'android/app/src/main/java/com/companionchat/WindowChromeModule.kt',
    );
    const app = read('App.tsx');

    const v2Setup = benchmark.slice(
      benchmark.indexOf(
        'private fun MacrobenchmarkScope.openV2ChatForSetup()',
      ),
      benchmark.indexOf(
        'private fun MacrobenchmarkScope.scrollAwayFromLatest()',
      ),
    );
    expect(v2Setup).toContain('--ez benchmark_read_only true');
    expect(v2Setup).toContain('companionchat://chat-v2/$providerId');
    expect(v2Setup).not.toContain('startActivityAndWait()');

    expect(activity).toContain(
      'const val BENCHMARK_READ_ONLY_EXTRA = "benchmark_read_only"',
    );
    expect(activity).toContain(
      'BuildConfig.ALLOW_BENCHMARK_ROUTES &&',
    );
    expect(activity).toContain(
      'candidate.getBooleanExtra(BENCHMARK_READ_ONLY_EXTRA, false)',
    );
    expect(activity.indexOf('updateBenchmarkLaunch(intent)')).toBeLessThan(
      activity.indexOf('super.onCreate(savedInstanceState)'),
    );
    expect(nativeModule).toContain(
      '"benchmarkReadOnly" to MainActivity.benchmarkReadOnlyLaunch',
    );
    expect(app).toContain('benchmarkReadOnlyLaunch');
    expect(app).toContain(
      "useGlobalOutboxDrain(boot.phase === 'ready' && !benchmarkReadOnlyLaunch)",
    );
    expect(app).toContain('benchmarkReadOnly: benchmarkReadOnlyLaunch');
  });

  it('keeps release incapable of accepting the V2 test link', () => {
    const gradle = read('android/app/build.gradle');
    const buildTypes = gradle.slice(gradle.indexOf('buildTypes {'));
    const release = buildTypes.slice(
      buildTypes.indexOf('release {'),
      buildTypes.indexOf('closedTest {'),
    );
    const internal = buildTypes.slice(buildTypes.indexOf('internal {'));

    expect(release).toContain(
      'buildConfigField "boolean", "ALLOW_BENCHMARK_ROUTES", "false"',
    );
    expect(release).not.toContain(
      'buildConfigField "boolean", "ALLOW_BENCHMARK_ROUTES", "true"',
    );
    expect(internal).toContain(
      'buildConfigField "boolean", "ALLOW_BENCHMARK_ROUTES", "true"',
    );
  });

  it('carries internal-only benchmark read-only state into the controller and UI', () => {
    const app = read('App.tsx');
    const routes = read('src/lib/routes.ts');
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    const composer = read('src/chat-v2/ChatComposerV2.tsx');
    const list = read('src/chat-v2/ChatListV2.tsx');
    const controller = read('src/chat-v2/useChatV2Controller.ts');

    expect(routes).toContain('readonly benchmarkReadOnly: boolean');
    expect(app).toContain('benchmarkReadOnly: benchmarkReadOnlyLaunch');
    expect(app).toContain('benchmarkReadOnly={route.benchmarkReadOnly}');
    expect(screen).toContain(
      'useChatV2Controller(providerId, benchmarkReadOnly)',
    );
    expect(screen).toContain('benchmarkReadOnly ? undefined : onStartCall');
    expect(controller).toContain('chatV2MutationInputs({');
    expect(controller).toMatch(
      /useMarkRead\(\s*mutationInputs\.markReadConversationId,\s*mutationInputs\.markReadSelfId,\s*\)/,
    );
    expect(controller).toContain(
      'useOutboxReplay(mutationInputs.outboxConversationId, send)',
    );
    expect(controller).toContain(
      'useAnnounceChatOpen(\n    mutationInputs.announceConversationId,\n    mutationInputs.announceEnabled,',
    );
    expect(screen).toContain('readOnly={benchmarkReadOnly}');
    expect(list).toContain('mutationsDisabled={readOnly}');
    expect(composer).toContain('disabled={disabled || readOnly}');
    expect(composer).toMatch(/if \(disabled \|\| readOnly \|\| text\.trim\(\) === ''\)/);
    expect(controller).toContain('if (benchmarkReadOnly)');
  });

  it('ships a serial- and provider-scoped geometry probe', () => {
    const script = read('scripts/v2-device-gates.mjs');
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['android:v2-device-gates']).toContain(
      'scripts/v2-device-gates.mjs',
    );
    expect(script).toContain("arg('serial'");
    expect(script).toContain("arg('provider'");
    expect(script).toContain('uiautomator');
    expect(script).toContain('chat-v2-page-down');
    expect(script).toContain('chat-v2-page-down-visible');
    expect(script).toContain('chat-v2-dock');
    expect(script).toContain("startsWith('chat-v2-row-')");
    expect(script).toContain('anchorResourceId');
    expect(script).toContain("dumpsys', 'window', 'insets'");
    expect(script).toContain('parseImeInsets');
    expect(script).not.toContain('dumpsys\', \'input_method');
    expect(script).toContain('closedGapDp');
    expect(script).toContain('openGapDp');
    expect(script).toContain('descriptionPrefix');
    expect(script).toContain('MAX_ANCHOR_DRIFT_DP = 4');
    expect(script).toContain('MIN_PAGE_DOWN_GAP_DP = 8');
  });

  it('marks page-down visibility and the full measured dock explicitly', () => {
    const pageDown = read('src/chat-v2/ChatPageDownV2.tsx');
    const screen = read('src/chat-v2/ChatScreenV2.tsx');

    expect(pageDown).toContain('testID="chat-v2-page-down-visible"');
    expect(pageDown).toMatch(/visible\s*\?\s*\(/);
    expect(screen).toContain('testID="chat-v2-dock"');
    expect(screen).toMatch(
      /testID="chat-v2-dock"[\s\S]{0,120}onLayout=\{onDockLayout\}/,
    );
  });

  it('hard-asserts IME and journey end states using exact row identity', () => {
    const benchmark = read(benchmarkPath);

    expect(benchmark).toContain('waitForIme(shown = true)');
    expect(benchmark).toContain('waitForIme(shown = false)');
    expect(benchmark).toContain('dumpsys window insets');
    expect(benchmark).toContain('readImeInsets()');
    expect(benchmark).not.toContain('dumpsys input_method');
    expect(benchmark).toMatch(
      /if \(readImeInsets\(\)\.visible\) \{\s*device\.pressBack\(\)/,
    );
    expect(benchmark).toContain('requireUniqueRowAnchor()');
    expect(benchmark).toContain('anchor.resourceName');
    expect(benchmark).toContain('requireObject(anchorResourceId)');
    expect(benchmark).toContain('waitUntilGone("chat-v2-page-down-visible")');
    expect(benchmark).toContain('check(grown.visibleBounds.height() > beforeHeight)');
    expect(benchmark).not.toContain('?.click()');
  });

  it('runs a fresh physical FeelBenchmark result through the threshold gate', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const runner = read('scripts/run-feel-benchmark.mjs');

    expect(pkg.scripts['android:benchmark:feel']).toBe(
      'node scripts/run-feel-benchmark.mjs',
    );
    expect(pkg.scripts['android:benchmark:feel:collect']).toContain(
      'FeelBenchmark',
    );
    expect(pkg.scripts['android:benchmark:feel:collect']).not.toContain(
      'suppressErrors=EMULATOR',
    );
    expect(runner).toContain('rmSync(OUTPUT_DIR');
    expect(runner).toContain('FeelBenchmark');
    expect(runner).toContain('benchmark-gate.mjs');
    expect(runner).toContain("'--strict'");
    expect(runner).not.toContain('suppressErrors=EMULATOR');
  });

  it('strict benchmark gate fails when required frame metrics are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pappal-benchmark-gate-'));
    const json = join(dir, 'FeelBenchmark_missing_benchmarkData.json');
    writeFileSync(
      json,
      JSON.stringify({
        benchmarks: [
          {
            name: 'imeOpenCloseFrames',
            className: 'com.companionchat.baselineprofile.FeelBenchmark',
            metrics: {},
          },
        ],
      }),
    );
    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/benchmark-gate.mjs', '--json', json, '--strict'],
        { cwd: ROOT, encoding: 'utf8' },
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'required metric "frameDurationCpuMs" is missing',
      );
      expect(`${result.stdout}${result.stderr}`).toContain(
        'required metric "frameOverrunMs" is missing',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('provides an unexecuted ARTEMIS checklist for visual and accessibility checks', () => {
    const checklist = read('scripts/artemis-v2-checklist.md');

    for (const expected of [
      'NOT RUN',
      'chat-v2-input',
      'chat-v2-message-mine',
      'chat-v2-message-peer',
      'chat-v2-call',
      'chat-v2-own-menu',
      'paper-menu-edit',
      'paper-menu-delete',
      'reaction-strip',
      'chat-v2-page-down',
      'chat-v2-page-down-visible',
      'chat-v2-dock',
      'chat-v2-row-',
      'same row resource ID',
      'isolated test account',
      'must not send',
      '≤ 4dp',
      '≤ 2dp',
      '≥ 8dp',
      'TalkBack',
    ]) {
      expect(checklist).toContain(expected);
    }
  });
});

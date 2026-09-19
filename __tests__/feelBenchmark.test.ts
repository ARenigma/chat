import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The feel benchmark measures the V2 chat interactions this app is judged on
 * by feel, while retaining the established tab and production-route journeys.
 */
describe('feel benchmark', () => {
  const bench = read(
    'android/baselineprofile/src/main/java/com/companionchat/baselineprofile/FeelBenchmark.kt',
  );

  it('covers the V2 device journeys and preserves existing navigation journeys', () => {
    for (const name of [
      'imeOpenCloseFrames',
      'repeatedInteractiveRetractFrames',
      'multilineComposerGrowthFrames',
      'pageDownJumpFrames',
      'composerControlSwapFrames',
      'scrolledUpAnchorPreservationFrames',
      'tabSwitchFrames',
      'chatPushPopFrames',
    ]) {
      expect(bench).toContain(`fun ${name}()`);
    }
    expect(bench).toContain('FrameTimingMetric()');
    expect(bench).not.toContain('emojiSwapFrames');
    expect(bench).not.toContain('attachOpenFrames');
    expect(bench).not.toContain('composer-emoji');
    expect(bench).not.toContain('composer-attach');
  });

  it('SKIPS on a slow panel rather than passing on slack', () => {
    // The thresholds are 120Hz thresholds. On a 60Hz panel every frame has
    // 16.7ms instead of 8.3ms, so the same code passes trivially while looking
    // like a pass. assumeTrue skips; a skipped benchmark is honest about having
    // no data.
    expect(bench).toContain('assumeTrue(');
    expect(bench).toContain('hz >= MIN_REFRESH_HZ');
    // 119, not 120: a panel in its fast mode reports a hair under.
    expect(bench).toContain('MIN_REFRESH_HZ = 119f');
    // And the message names the most likely cause, which is a Samsung toggle
    // rather than the hardware.
    expect(bench).toContain('Motion smoothness');
    expect(read('docs/android-audit.md')).toContain('Motion smoothness');
  });

  it('reads the CURRENT refresh rate, not the panel maximum', () => {
    expect(bench).toContain('getDisplay(Display.DEFAULT_DISPLAY)');
    expect(bench).toContain('display?.refreshRate');
  });

  it('keeps opening the chat out of the measured block', () => {
    // Folding the push into a composer-swap measurement would put a route
    // transition's frames into the swap's numbers. The push has its own test.
    const inChat = bench.slice(bench.indexOf('private fun measureInV2Chat'));
    expect(inChat).toContain('setupBlock = {');
    const setup = inChat.slice(inChat.indexOf('setupBlock = {'));
    expect(setup).toContain('openV2ChatForSetup()');
    expect(setup).toContain('chat-v2-screen');
  });

  it('leaves the thresholds to the one place that owns them', () => {
    // Macrobenchmark writes benchmarkData.json; scripts/benchmark-gate.mjs
    // enforces P95/P99/frameOverrunMs against it. Duplicating the numbers per
    // test is how two gates end up disagreeing.
    // Stripped of comments first: the file EXPLAINS the thresholds at length,
    // and a gate that cannot tell prose from code fails on its own rationale.
    const code = bench
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/8\.3|16\.7/);
    expect(bench).toContain('scripts/benchmark-gate.mjs');

    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['android:benchmark:feel']).toBe(
      'node scripts/run-feel-benchmark.mjs',
    );
    expect(pkg.scripts['android:benchmark:feel:collect']).toContain(
      'FeelBenchmark',
    );
    expect(pkg.scripts['android:benchmark:feel:collect']).toContain(
      'connectedNonMinifiedInternalAndroidTest',
    );
  });
});

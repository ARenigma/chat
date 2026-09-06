import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The display's refresh rate is READ, not guessed (workstream W0#1).
 *
 * `startFrameWatch` inferred it from a rolling median of rAF deltas because
 * nothing exposed the real number. That inference cannot distinguish a 60 Hz
 * panel from a 120 Hz panel dropping every other frame — both produce a
 * ~16.7 ms median — so every jank row on the S22 could have been mislabelled.
 */
describe('display refresh rate', () => {
  const module = read(
    'android/app/src/main/java/com/companionchat/WindowChromeModule.kt',
  );
  const bridge = read('src/lib/windowChrome.ts');
  const telemetry = read('src/lib/perfTelemetry.ts');

  it('reads the CURRENT mode, which is what the vote changes', () => {
    // getRefreshRate() reports the mode in force, including MainActivity's own
    // preferredDisplayModeId vote — not the panel's maximum capability.
    expect(module).toContain('fun getRefreshRate(promise: Promise)');
    expect(module).toContain('display?.refreshRate');
    expect(module).toContain(
      'https://developer.android.com/reference/android/view/Display#getRefreshRate()',
    );
  });

  it('reads it on the UI thread and survives a detached activity', () => {
    // Activity.getDisplay() throws when the activity is not attached, and the
    // display is a window-manager property.
    const body = module.slice(module.indexOf('fun getRefreshRate'));
    expect(body).toContain('UiThreadUtil.runOnUiThread');
    expect(body).toMatch(/currentActivity\s*\n?\s*if \(activity == null\)|activity == null/);
    // API 30 split: Activity.getDisplay() above, the deprecated defaultDisplay
    // below, since minSdk is 24.
    expect(body).toContain('Build.VERSION_CODES.R');
    expect(body).toContain('windowManager.defaultDisplay');
  });

  it('reports absence rather than a zero', () => {
    // A refresh rate of 0 is not a measurement. Handing it to the caller would
    // make `1000 / hz` infinite and every frame jank.
    expect(module).toContain('if (hz > 1f) hz.toDouble() else null');
    expect(bridge).toContain("typeof hz === 'number' && hz > 1 ? hz : null");
  });

  it('never lets a perf signal crash the app', () => {
    const fn = bridge.slice(bridge.indexOf('export async function readRefreshRate'));
    expect(fn).toContain('try {');
    expect(fn).toContain('return null;');
  });

  it('latches the measurement so the inference cannot overwrite it', () => {
    // The native answer arrives asynchronously, after the rAF estimator has
    // already been running. Without the latch the next frame's median would
    // replace the real number with a guess.
    expect(telemetry).toContain('let measured = false;');
    expect(telemetry).toContain('if (!measured && window.length >= 20)');
    expect(telemetry).toContain('void readRefreshRate().then(');
  });
});

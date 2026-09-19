import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('V2 development fast loop', () => {
  it('exposes the optimized Metro-served device command', () => {
    const scripts = (
      JSON.parse(read('package.json')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const devDevice = read('scripts/dev-device.sh');

    expect(scripts['android:dev']).toBe('bash scripts/dev-device.sh');
    expect(devDevice).toContain(':app:installDebug');
    expect(devDevice).toContain('-PmetroHotReload');
    expect(devDevice).toContain('-PreactNativeArchitectures=arm64-v8a');
    expect(devDevice).toContain('-x lint');
    expect(devDevice).toContain('-x test');
    expect(devDevice).toContain('--no-configuration-cache');
    expect(devDevice).toContain('ANDROID_SERIAL');
    expect(devDevice).toContain('adb reverse tcp:8081 tcp:8081');
    expect(devDevice).toContain('unzip -l');
    expect(devDevice).toContain('index.android.bundle');
  });

  it('holds the V2 peer until role resolution, then routes it into that tree', () => {
    const app = read('App.tsx');

    expect(app).toMatch(
      /parseChatV2Url\(\s*url,\s*__DEV__ \|\| allowBenchmarkRoutes,\s*\)/,
    );
    expect(app).toContain('pendingV2Peer');
    expect(app).toContain(
      'pendingV2Peer === null || isPending || role === undefined',
    );
    expect(app).toMatch(
      /if \(role === 'member'\)[\s\S]{0,180}name: 'chatV2'[\s\S]{0,80}providerId: pendingV2Peer/,
    );
    expect(app).toContain('benchmarkReadOnly: benchmarkReadOnlyLaunch');
    /*
     * The provider half, added 2026-09-19 with the parity sweep. The link used
     * to be dropped on that tree, which left the side with the DIFFERENT
     * shapes — no profile card, an earnings pill, a peer id
     * `open_conversation` rejects — unexercised right up to the cutover. The
     * role still picks the tree; both trees now have somewhere to send it.
     */
    expect(app).toMatch(/pushProvider\(\{\s*name: 'chatV2'/);
  });

  it('mounts an isolated V2 chat shell in the member tree', () => {
    const app = read('App.tsx');
    const shell = read('src/chat-v2/ChatScreenV2.tsx');

    expect(app).toContain(
      "import { ChatScreenV2 } from './src/chat-v2/ChatScreenV2'",
    );
    expect(app).toMatch(
      /route\.name === 'chatV2'[\s\S]{0,500}<ChatScreenV2[\s\S]{0,160}providerId=\{route\.providerId\}[\s\S]{0,160}onBack=/,
    );
    expect(shell).toContain('testID="chat-v2-screen"');
    expect(shell).toContain('<ChatListV2');
    expect(shell).toContain('<ChatComposerV2');
    expect(shell).toContain('providerId: string');
    expect(shell).toContain('onBack: () => void');
    expect(shell).not.toContain("from '../screens/ChatScreen'");
  });
});

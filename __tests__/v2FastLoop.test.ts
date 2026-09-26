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
    // nav-migration §3: V2 links are enqueued rather than held in React state.
    // The queue applies the intent once SignedIn registers the applier (role resolved).
    expect(app).toContain("enqueueIntent({\n            type: 'openChatV2'");
    expect(app).toContain('benchmarkReadOnly: benchmarkReadOnlyLaunch');
    /*
     * The navigator's intent applier (registered in onReady, step 7) pushes
     * ChatV2 into the conversations tab of whichever tree is mounted, and
     * both trees register it. The provider half, added 2026-09-19 with the
     * parity sweep, keeps the side with the DIFFERENT shapes — no profile
     * card, an earnings pill, a peer id `open_conversation` rejects —
     * exercised.
     */
    const nav = read('src/Navigation.tsx');
    expect(nav).toMatch(/case 'openChatV2':[\s\S]{0,600}chatTabOf\(root\)/);
    expect(nav.match(/name="ChatV2"/g) ?? []).toHaveLength(2);
  });

  it('mounts an isolated V2 chat shell in the member tree', () => {
    const route = read('src/screens/routes/ChatRoute.tsx');
    const shell = read('src/chat-v2/ChatScreenV2.tsx');

    expect(route).toContain("import { ChatScreenV2, type ChatV2Guard } from '../../chat-v2/ChatScreenV2'");
    expect(route).toMatch(/<ChatScreenV2[\s\S]{0,120}providerId=\{peerId\}[\s\S]{0,160}onBack=\{exit\}/);
    expect(shell).toContain('testID="chat-v2-screen"');
    expect(shell).toContain('<ChatListV2');
    expect(shell).toContain('<ChatComposerV2');
    expect(shell).toContain('providerId: string');
    expect(shell).toContain('onBack: () => void');
    expect(shell).not.toContain("from '../screens/ChatScreen'");
  });
});

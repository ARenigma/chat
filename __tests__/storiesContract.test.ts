import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stories, the rules a unit test cannot hold and a device check would find
 * late: which tree can reach which route, that a provider is never offered a
 * reply, how the video dependency is pinned and trimmed, and that picking
 * media asks for no new permission.
 */

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** The screen names one of Navigation.tsx's screen-list functions registers. */
function registered(fn: 'memberScreens' | 'providerScreens'): string[] {
  const nav = code('src/Navigation.tsx');
  const start = nav.indexOf(`function ${fn}(`);
  const end = nav.indexOf('\n}\n', start);
  return [...nav.slice(start, end).matchAll(/<Stack\.Screen name="(\w+)"/g)].map(m => m[1] as string);
}

describe('story routes', () => {
  it('registers the viewer in both trees and the create flow in the provider tree only', () => {
    expect(registered('memberScreens')).toContain('StoryViewer');
    expect(registered('providerScreens')).toContain('StoryViewer');
    expect(registered('providerScreens')).toContain('StoryCreate');
    expect(registered('memberScreens')).not.toContain('StoryCreate');
  });

  it('types StoryCreate as a provider param only', () => {
    const types = code('src/lib/routes/types.ts');
    const provider = types.slice(types.indexOf('export type ProviderScreenParams'));
    const member = types.slice(types.indexOf('export type MemberScreenParams'), types.indexOf('export type ProviderScreenParams'));
    expect(provider).toMatch(/StoryCreate: undefined/);
    expect(member).not.toMatch(/StoryCreate/);
  });

  it('hides the bottom bar on both, and never restores them after a re-gate', () => {
    const routes = code('src/screens/routes/StoryRoutes.tsx');
    expect(routes.match(/<Layout\.Screen minimalShell>/g)).toHaveLength(2);
    expect(code('src/Navigation.tsx')).toMatch(/NEVER_RESTORED[^;]*'StoryViewer', 'StoryCreate'/);
  });

  it('has a telemetry kind for each', () => {
    const kinds = code('src/lib/routes/screenNames.ts');
    expect(kinds).toContain("StoryViewer: 'storyViewer'");
    expect(kinds).toContain("StoryCreate: 'storyCreate'");
  });
});

describe('a provider cannot reply (147)', () => {
  const sheet = code('src/components/stories/StoryReplySheet.tsx');

  it('offers the comment input only when canComment says so', () => {
    expect(sheet).toContain('const member = canComment(selfId, story);');
    expect(sheet).toMatch(/const footer = member && storiesOn \?/);
    expect(sheet.match(/story-comment-input/g)).toHaveLength(1);
  });

  it('gives the provider a heart per comment, and members the "liked by creator" mark', () => {
    expect(sheet).toMatch(/\{own && storiesOn \? \(\s*<Pressable\s+onPress=\{\(\) => heart\.mutate/);
    expect(sheet).toMatch(/!own && c\.creator_reaction !== null/);
    expect(sheet).toContain('Liked by creator');
  });

  it('never calls post_story_comment from the provider tree screens', () => {
    for (const file of ['src/screens/ProviderChatsScreen.tsx', 'src/screens/StoryViewerScreen.tsx']) {
      expect(code(file)).not.toMatch(/postStoryComment|post_story_comment/);
    }
  });

  it('renders user text in its own Text node, never joined to app copy', () => {
    // The caption, a commenter's name and a comment body each stand alone.
    expect(sheet).toMatch(/>\s*\{story\.caption\}\s*</);
    expect(sheet).toMatch(/>\s*\{firstName\(c\.author_display_name\) \|\| c\.author_display_name\}\s*</);
    expect(sheet).toMatch(/>\s*\{c\.body\}\s*</);
    expect(code('src/screens/StoryViewerScreen.tsx')).toMatch(/>\s*\{who\.name\}\s*</);
  });
});

describe('the video dependency (RULE 5)', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };

  it('pins react-native-video exactly, on the maintained 6.x line', () => {
    expect(pkg.dependencies['react-native-video']).toBe('6.19.3');
  });

  it('compiles only the progressive player: no DASH, HLS, SmoothStreaming, IMA or RTSP', () => {
    const props = read('android/gradle.properties');
    for (const flag of ['Dash', 'Hls', 'SmoothStreaming', 'IMA', 'Rtsp']) {
      expect(props).toContain(`RNVideo_useExoplayer${flag}=false`);
    }
  });

  it('plays muted by default, never in the background, and pauses when not live', () => {
    const media = code('src/components/stories/StoryMedia.tsx');
    expect(media).toContain('playInBackground={false}');
    expect(media).toContain('paused={!playing}');
    expect(media).toContain('repeat');
    const viewer = code('src/screens/StoryViewerScreen.tsx');
    expect(viewer).toContain('const [muted, setMuted] = useState(true);');
    expect(viewer).toMatch(/focused && appActive && !sheetOpen && menuStep === null/);
  });
});

describe('picking story media asks for nothing new', () => {
  it('uses the Photo Picker path and adds no media permission', () => {
    const create = code('src/screens/StoryCreateScreen.tsx');
    expect(create).toContain('launchImageLibrary(');
    expect(create).toContain("mediaType: 'mixed'");
    expect(create).toContain('selectionLimit: 1');
    expect(create).not.toMatch(/PermissionsAndroid|launchCamera/);
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android.permission.READ_MEDIA_IMAGES" tools:node="remove"');
    expect(manifest).not.toMatch(/READ_MEDIA_VIDEO"\s*\/>/);
  });
});

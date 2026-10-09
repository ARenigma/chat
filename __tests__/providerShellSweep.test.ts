/**
 * Source-pin tests for the provider shell sweep (providerShellSweep).
 *
 * These are structural tests: they read source files and assert that the
 * fixes landed correctly, without requiring a running app or device.
 * Each test names the fix ID it covers.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

// ─── D4 ──────────────────────────────────────────────────────────────────────

describe('D4 – providerAvailability offline copy', () => {
  const src = read('src/lib/providerAvailability.ts');

  it('does not say "You are not listed"', () => {
    expect(src).not.toContain('You are not listed');
  });

  it('says members cannot start new conversations', () => {
    expect(src).toContain("Members can't start new conversations with you");
  });
});

// ─── D3 ──────────────────────────────────────────────────────────────────────

describe('D3 – SettingsSheet detail renders for default tone', () => {
  const src = read('src/screens/SettingsSheet.tsx');

  it('renders detail text unconditionally when non-empty', () => {
    // The old guard was `detailTone === 'attention'`; the new one checks only
    // that detail is truthy, and applies the attention colour conditionally.
    expect(src).not.toMatch(/detail && detailTone === 'attention'/);
  });

  it('applies attention style conditionally inside a single branch', () => {
    expect(src).toMatch(/detailTone === 'attention' && styles\.rowDetailAttention/);
  });
});

// ─── C1 ──────────────────────────────────────────────────────────────────────

describe('C1 – provider avatar tap opens photos, not clay sheet', () => {
  const settings = read('src/screens/SettingsSheet.tsx');
  const you = read('src/screens/ProviderYouScreen.tsx');

  it('SettingsSheet accepts onOpenPhotos prop', () => {
    expect(settings).toContain('onOpenPhotos?: () => void');
  });

  it('avatar tap branches on isProvider', () => {
    expect(settings).toMatch(/isProvider && onOpenPhotos !== undefined/);
    expect(settings).toMatch(/onOpenPhotos\(\)/);
  });

  it('badge glyph is camera for providers', () => {
    expect(settings).toMatch(/name=\{isProvider \? 'camera' : 'plus'\}/);
  });

  it('ProviderYouScreen passes onOpenPhotos to SettingsSheet', () => {
    expect(you).toContain('onOpenPhotos={onOpenPhotos}');
  });
});

// ─── B6 ──────────────────────────────────────────────────────────────────────

describe('B6 – push gate not on You tab; Go offline action', () => {
  const gate = read('src/components/ProviderPushGate.tsx');
  const routes = read('src/screens/routes/ProviderRoutes.tsx');

  it('ProviderPushGate imports useAvailabilityToggle', () => {
    expect(gate).toContain('useAvailabilityToggle');
  });

  it('gate renders a Go offline button when available', () => {
    expect(gate).toContain('Go offline');
  });

  it('ProviderYouRoute does not render ProviderPushGate', () => {
    // Extract ProviderYouRoute function body.
    const start = routes.indexOf('export function ProviderYouRoute');
    const end = routes.indexOf('\nexport function', start + 1);
    const body = routes.slice(start, end === -1 ? undefined : end);
    expect(body).not.toContain('<ProviderPushGate');
  });
});

// ─── C5 ──────────────────────────────────────────────────────────────────────

describe('C5 – provider can preview own public profile', () => {
  const types = read('src/lib/routes/types.ts');
  const nav = read('src/Navigation.tsx');
  const you = read('src/screens/ProviderYouScreen.tsx');
  const routes = read('src/screens/routes/ProviderRoutes.tsx');

  it('ProviderScreenParams includes ProviderProfile', () => {
    // Within the ProviderScreenParams block.
    const block = types.slice(types.indexOf('ProviderScreenParams'), types.indexOf('MemberTabParams'));
    expect(block).toContain('ProviderProfile');
  });

  it('Navigation.tsx registers ProviderProfile in providerScreens', () => {
    const block = nav.slice(
      nav.indexOf('function providerScreens'),
      nav.indexOf('function useStackFrame'),
    );
    expect(block).toContain("name=\"ProviderProfile\"");
  });

  it('ProviderYouScreen has onOpenOwnProfile prop', () => {
    expect(you).toContain('onOpenOwnProfile');
  });

  it('ProviderYouRoute passes onOpenOwnProfile', () => {
    expect(routes).toContain('onOpenOwnProfile');
  });
});

// ─── C2 ──────────────────────────────────────────────────────────────────────

describe('C2 – gallery remove disabled at minimum', () => {
  const gallery = read('src/components/ProviderPhotoGallery.tsx');
  const photos = read('src/screens/ProviderPhotosScreen.tsx');

  it('remove button hidden when at minimum', () => {
    expect(gallery).toMatch(/minimum !== undefined && gallery\.length <= minimum/);
  });

  it('ProviderPhotosScreen passes minimum={MIN_PROVIDER_PHOTOS}', () => {
    expect(photos).toContain('minimum={MIN_PROVIDER_PHOTOS}');
  });

  it('migration 188 file exists', () => {
    const { existsSync } = require('fs');
    expect(existsSync(join(ROOT, 'supabase/migrations/188_provider_photos_minimum_three_delete_guard.sql'))).toBe(true);
  });
});

// ─── D1 ──────────────────────────────────────────────────────────────────────

describe('D1 – earnings card: config-driven share percent', () => {
  const you = read('src/screens/ProviderYouScreen.tsx');

  it('imports useEconomicsConfig', () => {
    expect(you).toContain('useEconomicsConfig');
  });

  it('share percent is not hardcoded as 60', () => {
    // The string 60% as a literal (not inside a template expression) should be gone.
    expect(you).not.toMatch(/'You keep 60%/);
  });

  it('uses sharePercent variable in copy', () => {
    expect(you).toContain('sharePercent');
  });
});

// ─── D7 – ProviderSavedScreen ─────────────────────────────────────────────────

describe('D7 – ProviderSavedScreen layout', () => {
  const src = read('src/screens/ProviderSavedScreen.tsx');

  it('uses useSafeAreaInsets for top inset', () => {
    expect(src).toContain('useSafeAreaInsets');
    expect(src).toContain('insets.top');
  });

  it('uses useBottomBarOffset for bottom padding', () => {
    expect(src).toContain('useBottomBarOffset');
    expect(src).toContain('barOffset');
  });

  it('shows loading state while isPending', () => {
    expect(src).toContain('isPending');
    expect(src).toContain('LoadingIndicator');
  });

  it('empty copy mentions the ⋯ menu', () => {
    expect(src).toContain('⋯ menu');
  });
});

// ─── D7 – StoryCreateScreen ──────────────────────────────────────────────────

describe('D7 – StoryCreateScreen IME and discard', () => {
  const src = read('src/screens/StoryCreateScreen.tsx');

  it('uses useImeSpace', () => {
    expect(src).toContain('useImeSpace');
    expect(src).toContain('imeSpace');
  });

  it('uses usePreventRemove for discard guard', () => {
    expect(src).toContain('usePreventRemove');
  });

  it('renders ConfirmDialog for discard', () => {
    expect(src).toContain('ConfirmDialog');
    expect(src).toContain('Discard story?');
  });
});

// ─── D7 – ProviderEditProfileScreen language cap ──────────────────────────────

describe('D7 – ProviderEditProfileScreen language cap', () => {
  const src = read('src/screens/ProviderEditProfileScreen.tsx');

  it('disables language chips at MAX_PROVIDER_LANGUAGES', () => {
    expect(src).toMatch(/!picked && \(draft\?\.languages\.length \?\? 0\) >= MAX_PROVIDER_LANGUAGES/);
  });
});

// ─── D7 – back button touch targets ──────────────────────────────────────────

describe('D7 – back button 48dp touch targets', () => {
  it('ProviderPhotosScreen barIcon is 48dp', () => {
    const src = read('src/screens/ProviderPhotosScreen.tsx');
    // Grab the barIcon style block.
    const at = src.indexOf('barIcon:');
    const block = src.slice(at, src.indexOf('},', at));
    expect(block).toMatch(/width:\s*48/);
    expect(block).toMatch(/height:\s*48/);
  });

  it('ProviderEditProfileScreen barIcon is 48dp', () => {
    const src = read('src/screens/ProviderEditProfileScreen.tsx');
    const at = src.indexOf('barIcon:');
    const block = src.slice(at, src.indexOf('},', at));
    expect(block).toMatch(/width:\s*48/);
    expect(block).toMatch(/height:\s*48/);
  });
});

describe('D3 keeps the one-line Bluesky rows (review fix)', () => {
  it('shows a default-tone detail only on rows that opt in', () => {
    const sheet = readFileSync(join(__dirname, '..', 'src/screens/SettingsSheet.tsx'), 'utf8');
    expect(sheet).toContain("{detail && (detailTone === 'attention' || showDetail) ? (");
    const you = readFileSync(join(__dirname, '..', 'src/screens/ProviderYouScreen.tsx'), 'utf8');
    expect((you.match(/showDetail: true,/g) ?? []).length).toBe(2);
  });
});

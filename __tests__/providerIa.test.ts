/**
 * The provider You tab re-laid (owner, 2026-09-25, "Option A approved"): the
 * sectioned settings list, the Get paid status, the photos sub-page and the
 * Edit profile screen.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTINGS_SECTIONS, visibleSections, type SettingsRowId } from '../src/lib/settingsSections';

const ROOT = join(__dirname, '..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

describe('the settings list is grouped into sections', () => {
  it('orders the sections Your profile, Money, App, Legal', () => {
    expect(SETTINGS_SECTIONS.map(s => s.title)).toEqual(['Your profile', 'Money', 'App', 'Legal']);
  });

  it('puts each row in the section the owner decided', () => {
    const where = Object.fromEntries(
      SETTINGS_SECTIONS.flatMap(s => s.rows.map(r => [r, s.id] as const)),
    );
    expect(where).toEqual({
      'edit-profile': 'profile',
      photos: 'profile',
      'get-paid': 'money',
      usage: 'money',
      transactions: 'money',
      invoices: 'money',
      notifications: 'app',
      theme: 'app',
      blocked: 'app',
      terms: 'legal',
      privacy: 'legal',
      refund: 'legal',
    });
  });

  it('gives the provider tree all four sections, in order', () => {
    const provider = new Set<SettingsRowId>([
      'edit-profile', 'photos', 'get-paid', 'usage', 'notifications', 'theme', 'blocked',
      'terms', 'privacy', 'refund',
    ]);
    expect(visibleSections(r => provider.has(r)).map(s => [s.id, s.rows])).toEqual([
      ['profile', ['edit-profile', 'photos']],
      ['money', ['get-paid', 'usage']],
      ['app', ['notifications', 'theme', 'blocked']],
      ['legal', ['terms', 'privacy', 'refund']],
    ]);
  });

  it('drops a section, label and all, when no row of it is offered', () => {
    const member = new Set<SettingsRowId>([
      'usage', 'transactions', 'invoices', 'notifications', 'theme', 'blocked', 'terms',
      'privacy', 'refund',
    ]);
    expect(visibleSections(r => member.has(r)).map(s => s.id)).toEqual(['money', 'app', 'legal']);
    expect(visibleSections(r => r === 'theme').map(s => s.id)).toEqual(['app']);
  });

  it('renders the sections from the model and keeps every Maestro id', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain('visibleSections(');
    expect(settings).toContain('testID={`settings-section-${section.id}`}');
    expect(settings).toContain('accessibilityRole="header"');
    for (const id of [
      'settings-usage', 'settings-transactions', 'settings-invoices', 'settings-theme',
      'settings-blocked', 'settings-terms', 'settings-privacy', 'settings-refund',
      'settings-notifications',
    ]) {
      expect(settings).toContain(`testID: '${id}'`);
    }
    for (const id of ['sign-out', 'delete-account', 'settings-avatar', 'settings-rate']) {
      expect(settings).toContain(`testID="${id}"`);
    }
  });

  it('opens the app notification settings, falling back to the app details page', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain("Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS'");
    expect(settings).toContain("key: 'android.provider.extra.APP_PACKAGE', value: 'com.companionchat'");
    expect(settings).toMatch(/\.catch\(\(\) => \{\s*Linking\.openSettings\(\)/);
    // The package the intent names is the one the app is built as.
    expect(read('android/app/build.gradle')).toContain('applicationId "com.companionchat"');
  });
});

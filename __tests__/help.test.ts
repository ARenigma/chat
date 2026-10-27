import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTINGS_SECTIONS } from '../src/lib/settingsSections';

const read = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf8');

describe('Help & feedback', () => {
  it('sits in the settings list immediately before Share', () => {
    const rows = SETTINGS_SECTIONS[0]?.rows ?? [];
    expect(rows.indexOf('help')).toBeGreaterThan(-1);
    expect(rows.indexOf('help')).toBe(rows.indexOf('share') - 1);
  });

  it('is wired on both trees and registered in both stacks', () => {
    expect(read('src/screens/routes/MemberRoutes.tsx')).toContain("onHelp={() => nav.push('HelpSettings')}");
    expect(read('src/screens/routes/ProviderRoutes.tsx')).toContain("onOpenHelp={() => nav.push('HelpSettings')}");
    expect(read('src/Navigation.tsx').match(/name="HelpSettings"/g)).toHaveLength(2);
  });

  it('writes to the one contact address on the website', () => {
    const screen = read('src/screens/HelpScreen.tsx');
    expect(screen).toContain("HELP_EMAIL = 'hello@pappal.live'");
    expect(screen).toContain('`mailto:${HELP_EMAIL}?subject=');
    expect(screen).toContain('.catch(');
    expect(screen).toContain('testID="help-write-to-us"');
    expect(screen).toContain('testID="help-back"');
    expect(read('web/about.html')).toContain('hello@pappal.live');
  });

  it('has a non-empty FAQ, with no em dashes', () => {
    // Read from source: importing the screen would load the native animation stack.
    const screen = read('src/screens/HelpScreen.tsx');
    const faq = screen.slice(screen.indexOf('export const FAQ'), screen.indexOf('export function HelpScreen'));
    const entries = [...faq.matchAll(/question:\s*'([^']*)',\s*answer:\s*'([^']*)'/g)];
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(entries.length).toBe((faq.match(/question:/g) ?? []).length);
    for (const [, question, answer] of entries) {
      expect(question?.trim()).toBeTruthy();
      expect(answer?.trim()).toBeTruthy();
    }
    expect(faq).not.toContain('\u2014');
  });
});

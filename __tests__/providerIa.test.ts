jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { getUser: jest.fn() }, from: jest.fn() },
}));
// The api module reaches the store, which reaches MMKV's native module.
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

/**
 * The provider You tab re-laid (owner, 2026-09-25, "Option A approved"): the
 * sectioned settings list, the Get paid status, the photos sub-page and the
 * Edit profile screen.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTINGS_SECTIONS, visibleSections, type SettingsRowId } from '../src/lib/settingsSections';
import { supabase } from '../src/lib/supabase';
import { getPaidStatus } from '../src/lib/payoutStatus';
import {
  ABOUT_MAX,
  HEADLINE_MAX,
  MAX_PROVIDER_LANGUAGES,
  changedParts,
  draftFromProfile,
  isProfileEditDirty,
  refusedField,
  validateProfileEdit,
  type ProfileEditDraft,
} from '../src/lib/providerProfileEdit';
import { ContactGuardRefusalError } from '../src/lib/contactGuard';
import { saveProviderProfile, type PayoutAccount, type PayoutReadiness } from '../src/api/provider';

const ROOT = join(__dirname, '..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

describe('the settings list is one Bluesky-style list', () => {
  // Amit, 2026-10-03: "bluesky doesnt have sections.. import it verbatim".
  it('is a single list with About last, and the legal rows moved into About', () => {
    expect(SETTINGS_SECTIONS).toHaveLength(1);
    expect(SETTINGS_SECTIONS[0]?.rows).toEqual([
      'edit-profile', 'photos', 'usage', 'transactions', 'invoices', 'get-paid',
      'notifications', 'theme', 'blocked', 'about',
    ]);
  });

  it('gives each tree only the rows it offers, in that order', () => {
    const provider = new Set<SettingsRowId>([
      'edit-profile', 'photos', 'get-paid', 'usage', 'notifications', 'theme', 'blocked', 'about',
    ]);
    expect(visibleSections(r => provider.has(r)).map(s => s.rows)).toEqual([
      ['edit-profile', 'photos', 'usage', 'get-paid', 'notifications', 'theme', 'blocked', 'about'],
    ]);
    expect(visibleSections(() => false)).toEqual([]);
  });

  it('renders the sections from the model and keeps every Maestro id', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain('visibleSections(');
    expect(settings).toContain('testID={`settings-section-${section.id}`}');
    // No section labels since 2026-10-03 (Bluesky's root list has none).
    expect(settings).not.toContain('style={styles.subheader}');
    for (const id of [
      'settings-usage', 'settings-transactions', 'settings-invoices', 'settings-theme',
      'settings-blocked', 'settings-about', 'settings-notifications',
    ]) {
      expect(settings).toContain(`testID: '${id}'`);
    }
    // The policy rows keep their Maestro ids on the About screen.
    const about = read('src/screens/AboutScreen.tsx');
    expect(about).toContain('testID={`settings-${p.key}`}');
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

describe('the You tab: earnings first, availability next, the list below', () => {
  const you = read('src/screens/ProviderYouScreen.tsx');

  it('draws the earnings card, with its stats inside, before availability', () => {
    const earnings = you.indexOf('testID="provider-earnings"');
    const statsAt = you.indexOf('testID="stat-minutes"');
    const cardEnd = you.indexOf('testID="stat-rating"');
    const availability = you.indexOf('testID="availability-toggle"');
    expect(earnings).toBeGreaterThan(-1);
    expect(statsAt).toBeGreaterThan(earnings);
    expect(availability).toBeGreaterThan(cardEnd);
    // Channels stay under the master switch.
    expect(you.indexOf('testID="provider-channels"')).toBeGreaterThan(availability);
  });

  it('keeps every existing id and adds the three new rows', () => {
    for (const id of [
      'testID="earned-notice"',
      'testID="stat-minutes"',
      'testID="stat-people"',
      'testID="stat-rating"',
      'testID="availability-toggle"',
      'testID="provider-channels"',
      "testID: 'you-edit-profile'",
      "testID: 'you-photos'",
      "testID: 'you-get-paid'",
    ]) {
      expect(you).toContain(id);
    }
    const photos = read('src/components/ProviderPhotoGallery.tsx');
    for (const id of ['provider-photos', 'photo-add', 'photo-remove-confirm']) {
      expect(photos).toContain(`testID="${id}"`);
    }
    expect(photos).toContain('testID={`photo-primary-${i}`}');
    expect(photos).toContain('testID={`photo-remove-${i}`}');
  });

  it('routes the rows to Payout, the photos page and Edit profile', () => {
    const routes = read('src/screens/routes/ProviderRoutes.tsx');
    expect(routes).toContain("onOpenPayout={() => nav.push('Payout')}");
    expect(routes).toContain("onOpenPhotos={() => nav.push('ProviderPhotos')}");
    expect(routes).toContain("onOpenEditProfile={() => nav.push('EditProfile')}");
    const nav = read('src/Navigation.tsx');
    expect(nav).toContain('<Stack.Screen name="ProviderPhotos" getComponent={() => ProviderPhotosRoute} />');
    expect(nav).toContain('<Stack.Screen name="EditProfile" getComponent={() => EditProfileRoute} />');
    const kinds = read('src/lib/routes/screenNames.ts');
    expect(kinds).toContain("ProviderPhotos: 'providerPhotos'");
    expect(kinds).toContain("EditProfile: 'editProfile'");
  });
});

describe('the Get paid row names the verification status', () => {
  const account = (verification_status: PayoutAccount['verification_status']): PayoutAccount => ({
    id: 'a',
    method: 'upi',
    upi_vpa: 'x@upi',
    account_number: null,
    ifsc: null,
    account_holder_name: null,
    verification_status,
    name_at_bank: null,
    verification_error: null,
  });
  const ready = (payout: boolean, pan: boolean): PayoutReadiness => ({
    payout_account_verified: payout,
    pan_verified: pan,
    can_go_live: payout && pan,
  });

  it.each([
    ['still loading', undefined, undefined, 'unknown'],
    ['nothing saved', ready(false, false), null, 'action'],
    ['verified, PAN too', ready(true, true), account('verified'), 'verified'],
    ['check running', ready(false, false), account('pending'), 'pending'],
    ['check failed', ready(false, false), account('failed'), 'action'],
    ['saved, never checked', ready(false, false), account('unverified'), 'action'],
    ['account verified, PAN missing', ready(true, false), account('verified'), 'action'],
  ] as const)('%s', (_name, readiness, acct, tone) => {
    expect(getPaidStatus(readiness, acct).tone).toBe(tone);
  });

  it('says the words, so the colour is never the only signal', () => {
    expect(getPaidStatus(ready(false, false), null).label).toMatch(/^Action needed/);
    expect(getPaidStatus(ready(false, false), account('pending')).label).toMatch(/^Pending/);
    expect(getPaidStatus(ready(true, true), account('verified')).label).toBe('Verified');
  });
});

describe('Edit profile validation matches the server CHECKs', () => {
  const base: ProfileEditDraft = {
    headline: 'I listen more than I talk',
    about: 'Ten years of listening.',
    languages: ['English'],
    expertise: [],
  };

  it('accepts a complete draft', () => {
    expect(validateProfileEdit(base)).toEqual({});
  });

  it('holds headline to 1..140 after trimming (006, 180)', () => {
    expect(validateProfileEdit({ ...base, headline: '   ' }).headline).toBeDefined();
    expect(validateProfileEdit({ ...base, headline: 'a'.repeat(HEADLINE_MAX) }).headline).toBeUndefined();
    expect(validateProfileEdit({ ...base, headline: 'a'.repeat(HEADLINE_MAX + 1) }).headline).toBeDefined();
    expect(HEADLINE_MAX).toBe(140);
    expect(read('supabase/migrations/006_phone_auth_and_provider_onboarding.sql')).toContain(
      'length(btrim(headline)) between 1 and 140',
    );
  });

  it('holds about to 1..2000 after trimming (042, 180)', () => {
    expect(validateProfileEdit({ ...base, about: '' }).about).toBeDefined();
    expect(validateProfileEdit({ ...base, about: 'a'.repeat(ABOUT_MAX + 1) }).about).toBeDefined();
    expect(ABOUT_MAX).toBe(2000);
    expect(read('supabase/migrations/042_about_directory_and_perf_events.sql')).toContain(
      'length(about) <= 2000',
    );
  });

  it('holds languages to 1..12 (075, language_list_is_sane) and topics to 8 (083)', () => {
    expect(validateProfileEdit({ ...base, languages: [] }).languages).toBeDefined();
    expect(
      validateProfileEdit({ ...base, languages: Array.from({ length: 13 }, (_, i) => `L${i}`) }).languages,
    ).toBeDefined();
    expect(MAX_PROVIDER_LANGUAGES).toBe(12);
    expect(
      validateProfileEdit({ ...base, expertise: Array.from({ length: 9 }, (_, i) => `T${i}`) }).expertise,
    ).toBeDefined();
    const migration = read('supabase/migrations/180_provider_edits_own_profile.sql');
    expect(migration).toContain('length(v_headline) not between 1 and 140');
    expect(migration).toContain('length(v_about) not between 1 and 2000');
    expect(migration).toContain('cardinality(v_languages) = 0 or not public.language_list_is_sane(v_languages)');
  });

  it('is dirty only when a trimmed value or a list changed', () => {
    expect(isProfileEditDirty(base, { ...base })).toBe(false);
    expect(isProfileEditDirty(base, { ...base, headline: `${base.headline}  ` })).toBe(false);
    expect(isProfileEditDirty(base, { ...base, about: 'Different.' })).toBe(true);
    expect(changedParts(base, { ...base, expertise: ['Grief'] })).toEqual({ fields: false, expertise: true });
    expect(changedParts(base, { ...base, languages: ['English', 'Hindi'] })).toEqual({
      fields: true,
      expertise: false,
    });
  });

  it('seeds the draft from the profile row, nulls as empty', () => {
    expect(draftFromProfile({ headline: null, about: null, languages: ['Hindi'], expertise: ['Grief'] })).toEqual({
      headline: '',
      about: '',
      languages: ['Hindi'],
      expertise: ['Grief'],
    });
  });

  it('names only the fields this form edits for a contact-guard refusal', () => {
    expect(refusedField('about')).toBe('about');
    expect(refusedField('display_name')).toBeNull();
    expect(refusedField(null)).toBeNull();
  });
});

describe('Edit profile saves through the existing writers', () => {
  const rpc = supabase.rpc as jest.Mock;
  const edit = (parts: { fields: boolean; expertise: boolean }) => ({
    headline: '  New headline  ',
    about: ' About ',
    languages: ['English'],
    expertise: ['Grief'],
    parts,
  });

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('sends the three fields to update_provider_profile, trimmed, then the tags', async () => {
    await saveProviderProfile(edit({ fields: true, expertise: true }));
    expect(rpc.mock.calls).toEqual([
      ['update_provider_profile', { p_headline: 'New headline', p_about: 'About', p_languages: ['English'] }],
      ['set_provider_expertise', { p_expertise: ['Grief'] }],
    ]);
  });

  it('sends only the write that changed', async () => {
    await saveProviderProfile(edit({ fields: false, expertise: true }));
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['set_provider_expertise']);
    rpc.mockClear();
    await saveProviderProfile(edit({ fields: true, expertise: false }));
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['update_provider_profile']);
  });

  it('maps the contact guard P0011 to a refusal naming the field, and stops', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0011', message: 'CONTACT_INFO', details: '{"category":"phone","field":"about"}' },
    });
    const err = await saveProviderProfile(edit({ fields: true, expertise: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContactGuardRefusalError);
    expect((err as ContactGuardRefusalError).refusal.field).toBe('about');
    expect((err as Error).message).toBe("Your about can't include contact details, links or social usernames.");
    // The tags were not sent after a refused fields write.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('throws the server sentence for any other refusal', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'a headline is 1 to 140 characters' } });
    await expect(saveProviderProfile(edit({ fields: true, expertise: false }))).rejects.toThrow(
      'a headline is 1 to 140 characters',
    );
  });
});

describe('Edit profile guards unsaved changes', () => {
  const routes = read('src/screens/routes/ProviderRoutes.tsx');
  const route = routes.slice(routes.indexOf('export function EditProfileRoute'), routes.indexOf('export function ChatRequestRoute'));
  const screen = read('src/screens/ProviderEditProfileScreen.tsx');

  it('prevents removal while dirty, and not once a save has landed', () => {
    expect(route).toMatch(/usePreventRemove\(dirty && !leaving, \(\{ data \}\) => \{\s*setHeld\(data\.action\);/);
    expect(route).toContain('onDirtyChange={setDirty}');
    expect(route).toContain('onSaved={() => setLeaving(true)}');
    expect(route).toMatch(/if \(leaving\) \{\s*navigation\.goBack\(\);/);
  });

  it('asks before discarding, and Discard replays the held action', () => {
    expect(route).toContain('title="Discard changes?"');
    expect(route).toContain('testID="edit-profile-discard-confirm"');
    expect(route).toMatch(/if \(action !== null\) \{\s*navigation\.dispatch\(action\);/);
    expect(route).toContain('onCancel={() => setHeld(null)}');
  });

  it('disables Save until the draft changed and is valid, and shows errors inline', () => {
    expect(screen).toContain('const canSave = dirty && !hasErrors(errors) && !save.isPending;');
    expect(screen).toContain('disabled={!canSave}');
    expect(screen).toContain('testID="edit-profile-save"');
    expect(screen).toContain("error={lineFor('headline')}");
    expect(screen).toContain("error={lineFor('about')}");
    expect(screen).toContain('refusedField(err.refusal.field)');
    expect(screen).toContain('useEffect(() => {\n    onDirtyChange(dirty);');
  });
});

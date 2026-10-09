/**
 * Provider onboarding fixes from the 2026-10-09 provider sweep (B1, B2, B3,
 * B10, B11). The screens are components jest does not render here, so the
 * wiring is pinned as source text, the way the neighbouring suites do it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');

describe('B1: finishing onboarding clears the intent and re-runs the post-auth gate', () => {
  const app = read('App.tsx');
  it('clears the intent when the role flips to provider, then re-runs the gate', () => {
    expect(app).toMatch(
      /prevRole\.current !== 'provider' && signedInRole === 'provider'[\s\S]{0,200}storage\.get\(PROVIDER_INTENT_KEY\) === '1'[\s\S]{0,200}storage\.remove\(PROVIDER_INTENT_KEY\)[\s\S]{0,200}onProviderOnboarded\(\)/,
    );
  });
  it('does not clear the intent in the mutation, which would skip that gate', () => {
    const provider = read('src/api/provider.ts');
    const hook = provider.slice(provider.indexOf('export function useCompleteProviderOnboarding'));
    expect(hook.slice(0, 2500)).not.toContain('storage.remove(PROVIDER_INTENT_KEY)');
  });
  it('treats only the intent, not identity_state, as the provider path', () => {
    expect(app).toContain("const onProviderPath = storage.get(PROVIDER_INTENT_KEY) === '1';");
  });
});

describe('B2: a PAN check that is not a real verification does not advance', () => {
  it('reports a valid PAN with no date of birth as its own failure', () => {
    expect(read('src/api/provider.ts')).toContain("if (identity === 'no-dob')");
    expect(read('src/screens/ProviderApplicationScreen.tsx')).toContain("panStatus === 'no-dob'");
  });
  it('writes pending, not failed, when the verification service refuses us', () => {
    const fn = read('supabase/functions/verify-pan/index.ts');
    expect(fn).toContain("const taxStatus = verified ? 'verified' : ourFault ? 'pending' : 'failed';");
  });
  it('names the go-live refusals instead of a generic failure', () => {
    const provider = read('src/api/provider.ts');
    expect(provider).toContain('Add at least 3 photos of yourself before going live.');
    expect(provider).toContain('Your verification is missing a date of birth.');
  });
});

describe('B3: the application can be resumed and re-entered', () => {
  it('resumes at confirm when both checks already passed', () => {
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).toMatch(/taxData\?\.status === 'verified'[\s\S]{0,120}payoutData != null/);
    expect(screen).toContain("setPhase('confirm');");
  });
  it('offers members a way back into the application from Settings', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toMatch(/'become-provider':\s*onBecomeProvider === undefined \|\| isProvider/);
    const routes = read('src/screens/routes/MemberRoutes.tsx');
    expect(routes).toMatch(/onBecomeProvider=\{\(\) => \{\s*[\s\S]{0,400}storage\.set\(PROVIDER_INTENT_KEY, '1'\);\s*nav\.push\('Apply', \{ from: 'settings' \}\);/);
  });
});

describe('B10: Get paid', () => {
  const bank = read('src/screens/ProviderBankScreen.tsx');
  it('fills each half of the form when its own query resolves', () => {
    expect(bank).toContain('if (!accountFilled.current && account !== undefined)');
    expect(bank).toContain('if (!panFilled.current && tax !== undefined)');
  });
  it('re-checks the PAN only when it changed', () => {
    expect(bank).toMatch(/if \(panValid && panChanged\) \{\s*savePan\.mutate/);
  });
  it('no longer offers the broken Cashfree 1-Click flow', () => {
    expect(bank).not.toContain('bank-verify-cashfree');
  });
});

describe('B11: Back during the checks cancels them', () => {
  it('ignores results from a run the user has backed out of', () => {
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).toContain('const thisRun = ++runIdRef.current;');
    expect(screen).toMatch(/onEditDetails = useCallback\(\(\) => \{[\s\S]{0,300}runIdRef\.current\+\+;/);
    expect((screen.match(/if \(runIdRef\.current !== thisRun\) return;/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

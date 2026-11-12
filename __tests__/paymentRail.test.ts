import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string): string => readFileSync(join(__dirname, '..', f), 'utf8');

describe('Cashfree is the payment rail in every build', () => {
  const sheet = read('src/screens/PaymentSheet.tsx');
  const billing = read('src/api/billing.ts');

  it('reaches Cashfree whenever payments are on, not only in sandbox builds', () => {
    expect(sheet).toContain('const isCashfree = PAYMENTS_ENABLED;');
    expect(sheet).toMatch(/autoStart &&\s*PAYMENTS_ENABLED &&/);
  });

  it('only labels Test mode in sandbox builds', () => {
    expect(sheet).toContain("CASHFREE_SANDBOX_CHECKOUT ? '  ·  Test mode' : ''");
  });

  it('picks the SDK environment from the build, so a production build is PRODUCTION', () => {
    expect(billing).toMatch(/CASHFREE_SANDBOX_CHECKOUT\s*\?\s*CFEnvironment\.SANDBOX\s*:\s*CFEnvironment\.PRODUCTION/);
  });
});

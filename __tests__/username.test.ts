import {
  isUsernameLocallyValid,
  usernameLocalStatus,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
} from '../src/lib/username';
import { isClayUri, claySource, CLAY_SEEDS } from '../src/lib/clayAvatars';

describe('username validation', () => {
  it('accepts valid handles', () => {
    expect(isUsernameLocallyValid('ada')).toBe(true);
    expect(isUsernameLocallyValid('Cool_Name42')).toBe(true);
    expect(usernameLocalStatus('ab')).toBe('too_short');
    expect(usernameLocalStatus('ok_name')).toBe('ok');
  });

  it('rejects invalid characters and length', () => {
    expect(isUsernameLocallyValid('a')).toBe(false);
    expect(isUsernameLocallyValid('name with space')).toBe(false);
    expect(isUsernameLocallyValid('x'.repeat(USERNAME_MAX + 1))).toBe(false);
    expect(usernameLocalStatus('bad-name')).toBe('invalid_chars');
  });

  it('documents pattern bounds', () => {
    expect(USERNAME_MIN).toBe(3);
    expect(USERNAME_MAX).toBe(24);
    expect(USERNAME_PATTERN.test('Abc_123')).toBe(true);
  });
});

describe('clay avatars', () => {
  it('resolves bundled clay URIs only for allowlisted seeds', () => {
    expect(isClayUri('clay:ada')).toBe(true);
    expect(isClayUri('https://example.com/x.png')).toBe(false);
    expect(claySource('clay:ada')).toBeTruthy();
    expect(claySource('clay:unknown')).toBeNull();
    expect(CLAY_SEEDS).toContain('luna');
  });
});

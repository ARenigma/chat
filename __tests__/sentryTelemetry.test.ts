/**
 * Pins the telemetry posture decided 2026-10-02: build identity from the
 * native build type (never APP_ENV / __DEV__), error-only replay masked
 * everywhere (owner's choice), explicit funnel logs only (no console capture),
 * trace headers only to our Edge Functions, and an attribute allowlist so a
 * log line can never carry content.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sentry = read('src/lib/sentry.ts');
const config = read('src/config.ts');
const gradle = read('android/app/build.gradle');

describe('Sentry init posture', () => {
  it('masks every replay and never records a session that had no error', () => {
    expect(sentry).toMatch(/maskAllText:\s*true/);
    expect(sentry).toMatch(/maskAllImages:\s*true/);
    expect(sentry).toMatch(/maskAllVectors:\s*true/);
    expect(sentry).toMatch(/replaysSessionSampleRate:\s*0\b/);
  });

  it('captures only explicit logs, never console output', () => {
    expect(sentry).toMatch(/enableAutoConsoleLogs:\s*false/);
    expect(sentry).toMatch(/logsOrigin:\s*'js'/);
  });

  it('sends trace headers only to Edge Functions', () => {
    const m = sentry.match(/tracePropagationTargets:\s*\[([^\]]*)\]/);
    expect(m?.[1]?.trim()).toBe('/\\/functions\\/v1\\//');
    const re = /\/functions\/v1\//;
    expect(re.test('https://x.supabase.co/functions/v1/send-call')).toBe(true);
    expect(re.test('https://x.supabase.co/rest/v1/messages')).toBe(false);
  });

  it('keeps sendDefaultPii off and the scrubbers wired', () => {
    expect(sentry).toMatch(/sendDefaultPii:\s*false/);
    expect(sentry).toMatch(/beforeSend:\s*event\s*=>\s*sanitizeSentryEvent/);
    expect(sentry).toMatch(/beforeBreadcrumb:/);
  });

  it('takes the environment from the build type, never APP_ENV or __DEV__', () => {
    expect(sentry).toMatch(/environment:\s*SENTRY_ENVIRONMENT/);
    const block = config.slice(config.indexOf('export const SENTRY_ENVIRONMENT'));
    expect(block.slice(0, 400)).not.toMatch(/APP_ENV|__DEV__/);
    for (const env of ['development', 'production', 'alpha', 'internal']) {
      expect(gradle).toContain(`buildConfigField "String", "SENTRY_ENVIRONMENT", '"${env}"'`);
    }
  });
});

describe('logEvent', () => {
  const mockInfo = jest.fn();
  jest.isolateModules(() => {
    jest.doMock('@sentry/react-native', () => ({
      logger: { info: (...a: unknown[]) => mockInfo(...a) },
      reactNavigationIntegration: () => ({ registerNavigationContainer: jest.fn() }),
      mobileReplayIntegration: () => ({}),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      init: jest.fn(),
    }));
    jest.doMock('../src/config', () => ({
      SENTRY_ENVIRONMENT: 'development',
      SENTRY_VERSION_NAME: '0.0.0',
      SENTRY_VERSION_CODE: 0,
    }));
    const { logEvent } = require('../src/lib/sentry');
    logEvent('session_ended', {
      reason: 'manual',
      minutes: 2,
      body: 'hello',
      phone: '9999990001',
    } as Record<string, unknown>);
  });

  it('drops every attribute outside the allowlist', () => {
    expect(mockInfo).toHaveBeenCalledWith('session_ended', { reason: 'manual', minutes: 2 });
  });
});

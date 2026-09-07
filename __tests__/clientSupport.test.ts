import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FALLBACK_CLIENT_SUPPORT,
  supportVerdict,
} from '../src/lib/clientSupport';

const read = (relative: string) =>
  readFileSync(join(__dirname, '..', relative), 'utf8');

/**
 * The gate that exists because of the 2026-09-07 skew: versionCode 10109
 * against migrations 077-079 deadlocked with no error on any layer. See
 * `src/lib/clientSupport.ts`.
 */
describe('the client support gate', () => {
  it('lets a current client through', () => {
    expect(supportVerdict(10111, 10110)).toEqual({ state: 'supported' });
  });

  it('lets a client that exactly meets the floor through', () => {
    // `have < need`, not `have <= need`. The floor is the first ALLOWED build,
    // not the first rejected one; off-by-one here locks out the very build
    // published to fix a skew.
    expect(supportVerdict(10110, 10110)).toEqual({ state: 'supported' });
  });

  it('stops the build below the floor, and says both numbers', () => {
    // The numbers are carried for logs, not for the screen — the copy in
    // App.tsx deliberately shows neither, because there is one action available
    // and "you are on 10109" does not help anyone take it.
    expect(supportVerdict(10109, 10110)).toEqual({
      state: 'must-update',
      have: 10109,
      need: 10110,
    });
  });

  it('reproduces the actual incident', () => {
    // The exact pair from 2026-09-07. Had this existed, the two testers would
    // have seen "time for an update" instead of a chat that silently could not
    // start a session.
    expect(supportVerdict(10109, 10110).state).toBe('must-update');
  });

  describe('fails open, which is the whole safety argument', () => {
    it('does not gate when the floor is unknown', () => {
      // The offline case. `FALLBACK_CLIENT_SUPPORT` applies when the config RPC
      // is unreachable, and failing closed there would turn "no network for ten
      // seconds" into a brick whose only remedy needs the network.
      expect(supportVerdict(10109, 0)).toEqual({ state: 'supported' });
      expect(supportVerdict(10109, FALLBACK_CLIENT_SUPPORT.min_version_code)).toEqual({
        state: 'supported',
      });
    });

    it('does not gate when this build cannot say what it is', () => {
      // A JS bundle newer than its native shell: every Metro reload against an
      // older debug install, where `getConstants()` has no versionCode. A dev
      // must not be locked out of their own app by a number it could not read.
      expect(supportVerdict(0, 10110)).toEqual({ state: 'supported' });
      expect(supportVerdict(-1, 10110)).toEqual({ state: 'supported' });
    });

    it('does not gate on values that are not real numbers', () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        expect(supportVerdict(bad, 10110)).toEqual({ state: 'supported' });
        expect(supportVerdict(10109, bad)).toEqual({ state: 'supported' });
      }
    });

    it('ships the fallback as no floor at all', () => {
      // If this ever becomes non-zero, every offline launch starts gating.
      expect(FALLBACK_CLIENT_SUPPORT.min_version_code).toBe(0);
    });
  });
});

describe('the gate is actually wired, not just written', () => {
  /*
   * `supportVerdict` failing open means a mis-wired gate raises nothing — it
   * silently does not gate, which is the same invisible-failure shape the gate
   * exists to end. So the wiring is asserted structurally.
   */
  const app = read('App.tsx');

  it('renders ahead of every boot phase, including signed-out', () => {
    const gate = app.indexOf('support.state === ');
    const loading = app.indexOf("boot.phase === 'loading'");
    const signedOut = app.indexOf("boot.phase === 'signedOut'");
    expect(gate).toBeGreaterThan(0);
    expect(loading).toBeGreaterThan(0);
    // An unsupported build must not reach sign-in: the one thing it cannot do
    // is satisfy the RPC contract, so authenticating first only carries it
    // deeper into a tree where nothing works.
    expect(gate).toBeLessThan(loading);
    expect(gate).toBeLessThan(signedOut);
  });

  it('compares this build against the published floor', () => {
    expect(app).toContain('supportVerdict(currentVersionCode()');
    expect(app).toContain('clientSupport?.min_version_code ?? 0');
  });

  it('offers a way out that cannot be a dead button', () => {
    // Play's immediate flow first; the store listing when Play has nothing to
    // offer (sideloaded, no Play Store, release not on this track yet).
    expect(app).toContain('startImmediateUpdate()');
    expect(app).toContain('market://details?id=com.companionchat');
  });
});

describe('the server half', () => {
  const migration = read('supabase/migrations/080_client_support_floor.sql');

  it('publishes the domain through the PUBLIC config door', () => {
    // Authenticated-only would defeat the point: the gate has to answer before
    // sign-in.
    expect(migration).toContain("'client_support'");
    expect(migration).toMatch(/p_domain not in \([^)]*'client_support'[^)]*\)/);
  });

  it('keeps the three domains that were already public', () => {
    // 080 reproduces the whole function body to add one value. This is the same
    // assertion pgTAP 340 makes at runtime, kept here too so the cheap gate
    // catches it before the DB suite has to.
    for (const domain of ['kill_switches', 'auth_ui', 'permissions']) {
      expect(migration).toContain(`'${domain}'`);
    }
  });

  it('seeds no floor rather than a version', () => {
    expect(migration).toMatch(/"min_version_code":\s*0/);
  });
});

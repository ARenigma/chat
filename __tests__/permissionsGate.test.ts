import {
  GATE_PERMISSIONS,
  appliesOnThisDevice,
  gateSatisfied,
  outstanding,
  type GatePermission,
  type GateStatuses,
} from '../src/lib/permissionsGate';

const all = (status: GateStatuses[keyof GateStatuses]): GateStatuses => ({
  microphone: status,
  camera: status,
  notifications: status,
});

describe('permissionsGate: what applies where', () => {
  const byKind = (kind: GatePermission['kind']): GatePermission => {
    const found = GATE_PERMISSIONS.find(p => p.kind === kind);
    if (found === undefined) {
      throw new Error(`no gate permission ${kind}`);
    }
    return found;
  };

  it('asks for mic and camera on every supported Android, notifications only from 13', () => {
    expect(appliesOnThisDevice(byKind('microphone'), 24, 'android')).toBe(true);
    expect(appliesOnThisDevice(byKind('camera'), 24, 'android')).toBe(true);
    expect(appliesOnThisDevice(byKind('notifications'), 29, 'android')).toBe(false);
    expect(appliesOnThisDevice(byKind('notifications'), 33, 'android')).toBe(true);
    // Not Android: nothing to ask, the gate is a pass-through.
    expect(appliesOnThisDevice(byKind('microphone'), 33, 'ios')).toBe(false);
  });

  it('names the manifest permissions exactly, with a reason and an icon each', () => {
    expect(GATE_PERMISSIONS.map(p => p.permission)).toEqual([
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.POST_NOTIFICATIONS',
    ]);
    for (const p of GATE_PERMISSIONS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.reason.length).toBeGreaterThan(20);
      expect(p.reason).not.toMatch(/—/);
      expect(p.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('permissionsGate: satisfied means every applicable one is granted', () => {
  it('passes when all three are granted, and on Android 12 without notifications', () => {
    expect(gateSatisfied(all('granted'), 33, 'android')).toBe(true);
    expect(gateSatisfied({ microphone: 'granted', camera: 'granted' }, 29, 'android')).toBe(true);
  });

  it('fails on any applicable denial or block', () => {
    expect(gateSatisfied({ ...all('granted'), camera: 'denied' }, 33, 'android')).toBe(false);
    expect(gateSatisfied({ ...all('granted'), notifications: 'blocked' }, 33, 'android')).toBe(false);
    // Notifications do not apply on 29, so a missing one is not a failure there.
    expect(gateSatisfied({ microphone: 'granted', camera: 'granted' }, 29, 'android')).toBe(true);
    expect(gateSatisfied({ microphone: 'granted', camera: 'granted' }, 33, 'android')).toBe(false);
  });

  it('is a pass-through off Android', () => {
    expect(gateSatisfied({}, 33, 'ios')).toBe(true);
  });

  it('lists what is outstanding in ask order and skips what does not apply', () => {
    expect(outstanding({ microphone: 'granted' }, 33, 'android').map(p => p.kind)).toEqual([
      'camera',
      'notifications',
    ]);
    expect(outstanding({}, 29, 'android').map(p => p.kind)).toEqual(['microphone', 'camera']);
    expect(outstanding(all('granted'), 33, 'android')).toEqual([]);
    expect(outstanding({ camera: 'blocked' }, 29, 'android').map(p => p.kind)).toEqual([
      'microphone',
      'camera',
    ]);
  });
});

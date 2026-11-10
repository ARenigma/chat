import { presencePrompt } from '../src/chat-v2/presencePrompt';

const NOW = Date.parse('2026-11-06T10:00:00Z');
const ONLINE = { here: true, line: 'Online' };
const AWAY = { here: false, line: 'Last seen today at 9:41 AM' };
const UNKNOWN = { here: false, line: null };
const ALERTED = { alerted: true, reason: null };

const base = {
  alert: ALERTED,
  isMemberSide: true,
  name: 'Asha',
  presence: AWAY,
  sessionActive: false,
  now: NOW,
  canCall: true,
};
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const cooldown = (minutes: number) => ({
  alerted: false,
  reason: 'cooldown',
  cooldown_until: at(minutes),
});

describe('presencePrompt: peer online now', () => {
  it('offers a Call action to the member', () => {
    expect(presencePrompt({ ...base, presence: ONLINE })).toEqual({
      text: 'Asha is online now. You can chat or call.',
      icon: 'check',
      action: { kind: 'call', label: 'Call Asha' },
    });
  });

  it('drops the Call action when a call cannot be started', () => {
    expect(presencePrompt({ ...base, presence: ONLINE, canCall: false })).toEqual({
      text: 'Asha is online now. You can chat or call.',
      icon: 'check',
    });
  });

  it('tells the provider to say hello, with no action', () => {
    expect(presencePrompt({ ...base, isMemberSide: false, presence: ONLINE })).toEqual({
      text: "Asha is online now. Say hello when you're ready.",
      icon: 'check',
    });
  });

  it('on the provider side, where a member has no published presence, trusts peer_present', () => {
    expect(
      presencePrompt({
        ...base,
        isMemberSide: false,
        presence: UNKNOWN,
        alert: { alerted: false, reason: 'peer_present', peer_present: true },
      })?.text,
    ).toBe("Asha is online now. Say hello when you're ready.");
  });
});

describe('presencePrompt: away and pinged', () => {
  it('promises a join on the member side', () => {
    expect(presencePrompt(base)).toEqual({
      text: "Asha is away. We've let them know, and they'll join you here soon.",
      icon: 'bell',
    });
  });

  it('makes no promise on the provider side, and no "we will tell you" push', () => {
    const p = presencePrompt({ ...base, isMemberSide: false });
    expect(p).toEqual({ text: "Asha is away. We've let them know.", icon: 'bell' });
  });

  it('reads as away when live presence is unknown but the open pinged them', () => {
    expect(presencePrompt({ ...base, presence: UNKNOWN })?.icon).toBe('bell');
  });
});

describe('presencePrompt: live presence wins', () => {
  it('flips an "away" open to "online" when the peer comes online', () => {
    expect(presencePrompt({ ...base, presence: AWAY })?.icon).toBe('bell');
    expect(presencePrompt({ ...base, presence: ONLINE })?.icon).toBe('check');
  });

  it('disappears once a session is live', () => {
    expect(presencePrompt({ ...base, presence: ONLINE, sessionActive: true })).toBeNull();
    expect(presencePrompt({ ...base, sessionActive: true })).toBeNull();
  });

  it('a stale peer_present open reads online when live says online', () => {
    expect(
      presencePrompt({
        ...base,
        presence: ONLINE,
        alert: { alerted: false, reason: 'peer_present', peer_present: true },
      })?.icon,
    ).toBe('check');
  });

  it('a stale peer_present open says nothing when live says away: nobody was pinged', () => {
    expect(
      presencePrompt({
        ...base,
        presence: AWAY,
        alert: { alerted: false, reason: 'peer_present', peer_present: true },
      }),
    ).toBeNull();
  });

  it('online beats a cooldown and a no_balance answer', () => {
    expect(presencePrompt({ ...base, presence: ONLINE, alert: cooldown(10) })?.icon).toBe('check');
    expect(
      presencePrompt({
        ...base,
        presence: ONLINE,
        alert: { alerted: false, reason: 'no_balance' },
      })?.icon,
    ).toBe('check');
  });
});

describe('presencePrompt: cooldown', () => {
  it('names the wait in minutes, rounded up, for both sides', () => {
    for (const isMemberSide of [true, false]) {
      expect(presencePrompt({ ...base, isMemberSide, alert: cooldown(10) })).toEqual({
        text: 'You nudged Asha a few minutes ago.',
        sub: 'You can nudge again in 10 min.',
        icon: 'bell',
      });
    }
  });

  it('rounds a partial minute up and never shows 0', () => {
    expect(
      presencePrompt({ ...base, alert: { ...cooldown(0), cooldown_until: at(9.1) } })?.sub,
    ).toBe('You can nudge again in 10 min.');
    expect(
      presencePrompt({ ...base, alert: { ...cooldown(0), cooldown_until: at(0.01) } })?.sub,
    ).toBe('You can nudge again in 1 min.');
  });

  it('shows hours past an hour', () => {
    expect(presencePrompt({ ...base, alert: cooldown(60) })?.sub).toBe(
      'You can nudge again in 60 min.',
    );
    expect(presencePrompt({ ...base, alert: cooldown(61) })?.sub).toBe(
      'You can nudge again in 1 hr 1 min.',
    );
    expect(presencePrompt({ ...base, alert: cooldown(120) })?.sub).toBe(
      'You can nudge again in 2 hr.',
    );
  });

  it('is silent once the cooldown has passed or its time is missing', () => {
    expect(presencePrompt({ ...base, alert: cooldown(-1) })).toBeNull();
    expect(
      presencePrompt({ ...base, alert: { alerted: false, reason: 'cooldown' } }),
    ).toBeNull();
  });
});

describe('presencePrompt: no_balance', () => {
  const alert = { alerted: false, reason: 'no_balance' };

  it('asks the member to add balance, with the recharge action', () => {
    expect(presencePrompt({ ...base, alert })).toEqual({
      text: 'Add a little balance to nudge Asha.',
      sub: 'A nudge needs at least one minute of balance.',
      icon: 'bell',
      action: { kind: 'recharge', label: 'Add balance' },
    });
  });

  it("never reveals the member's balance to the provider", () => {
    expect(presencePrompt({ ...base, alert, isMemberSide: false })).toBeNull();
  });
});

describe('presencePrompt: silence', () => {
  it.each(['in_session', 'unauthorized', 'forbidden', 'not_found', 'not_configured'])(
    '%s says nothing, even with the peer online',
    reason => {
      for (const presence of [ONLINE, AWAY, UNKNOWN]) {
        expect(
          presencePrompt({ ...base, presence, alert: { alerted: false, reason } }),
        ).toBeNull();
      }
    },
  );

  it('says nothing before the open answers, or while the name is unresolved', () => {
    expect(presencePrompt({ ...base, alert: null })).toBeNull();
    expect(presencePrompt({ ...base, name: '' })).toBeNull();
  });
});

describe('presencePrompt: copy', () => {
  it('has no em dash and no "please"', () => {
    const all = [
      presencePrompt({ ...base, presence: ONLINE }),
      presencePrompt({ ...base, isMemberSide: false, presence: ONLINE }),
      presencePrompt(base),
      presencePrompt({ ...base, alert: cooldown(90) }),
      presencePrompt({ ...base, alert: { alerted: false, reason: 'no_balance' } }),
    ].map(p => JSON.stringify(p));
    for (const s of all) {
      expect(s).not.toMatch(/—|please/i);
    }
  });
});

describe('presencePrompt: wiring', () => {
  const read = (p: string): string =>
    (require('fs') as typeof import('fs')).readFileSync(`${__dirname}/../${p}`, 'utf8');

  it('the Call action reuses the header call path and Add balance opens the refill sheet', () => {
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    expect(screen).toMatch(/kind === 'recharge'\) \{\s+openRefill\(\);\s+return;\s+\}\s+startCall\('audio'\);/);
  });
});

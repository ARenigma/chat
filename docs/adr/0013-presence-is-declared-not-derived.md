# 0013. Presence is declared, and a listing switch is not presence

Status: accepted
Date: 2026-08-22
Supersedes nothing. Completes work started in 011.

## Context

Three things were called presence in this codebase and none of them was.

**A Realtime presence channel.** `src/api/realtime.ts` tracked the caller's own
connection and read the peer's back out of a `presence` sync event, which the
chat header rendered as a dot and a "Here now" line. That answers "is their app
in the foreground". Nobody agreed to have that answered about them, it cannot be
turned off, and in a product about loneliness a dot implying somebody is waiting
is a nudge built on a fact we do not have.

The header had already stopped reading it by the time this change landed, and the
channel had not: `useLiveConversation` was still opening a `presence` channel and
still calling `track()`, so every device was publishing "my app is in the
foreground" for a signal nothing consumed. That is the worst of the three states.
It is gone now, along with the `peerOnline` slice in the store, because a presence
flag sitting in a store is an invitation for the next screen to render it.

**`profiles.is_available`.** The provider's directory listing switch: listed for
discovery, open to new conversations. Four surfaces rendered it as a presence dot
(the directory row, the inbox row, the chat header, and the shortcut rail, which
hardcoded the dot on). So a provider who wanted work but had put the phone down
still read as here, and the switch's own card said "You are hidden" while meaning
"not listed".

**`profiles.presence_visible` and `last_active_at`, added by 011.** A derived
last-seen stamp behind a visibility switch, which is WhatsApp's Last Seen. That
one is genuinely consented and it stays. What it cannot do is let a person say
"I am here, talk to me" or "I am around but not now", and those are the two
statements somebody actually wants to make.

Underneath all of it: a **member could not be present at all**.
`conversation_peers.peer_available` is `case when peer.role = 'provider' then
peer.is_available else false end`, so a member peer was false forever, and
`ProviderHomeScreen` had given up and written `online={false}`. That was not
laziness. There was no value available that could ever be true. The person most
in need of being seen as present, the one waiting for a reply, was the one the
schema could not represent.

Separately, 011's `member_is_pseudonymous` CHECK closed the member half of
pseudonymity and left the other half open: the "Profile updatable by owner"
policy still let a **provider** PATCH their own `gender` and `headline` from a
client. Members pay to choose a person on exactly those fields plus the age.

## Decision

**Presence is a declared enum, `presence_choice`, with three values.**
`here` publishes the word and lights a dot, `away` publishes the word and the
last-seen stamp if one exists, `hidden` publishes nothing. It defaults to
`hidden`, so a product whose pitch is safety does not start telling a paid
stranger when you were last awake without being asked.

**Three values, not a boolean.** `away` and `hidden` are observably different to
the person looking. Collapsing them would make opting out of presence and
declaring yourself absent the same statement, and they are not: one is a fact
about you, the other is a refusal to supply one.

**`is_available` survives and keeps its meaning.** It has eight call sites, two
partial indexes from 006, a pinned contract assertion, and a real job: the
directory rail, the "N people free now" count and the sort are all about openness
to something new, which is the right thing to build a shortcut out of. What it
lost is a job it was never right for. A provider is entitled to be here and
closed for work, or listed and asleep.

**Both roles get the same control in the same place.** `SettingsSheet` is mounted
on both trees, so one three-row group covers both. Presence is not a provider
feature.

**One control writes two columns.** `presence` and `presence_visible` stay
independent in the schema, because the stamp has its own guard from 011 and 011's
suite pins it. Offering a person two switches for one thought is not a design, so
`useSetPresence` writes both in one UPDATE, and `readPresence` ignores a stamp
that contradicts a hidden choice, so a half-applied write fails closed.

**The three PII columns become unwritable by any client**, via a fourth additive
guard trigger on `profiles`. After it, the only writer is
`approve_provider_application`, which is SECURITY DEFINER and copies the five
application fields in the same UPDATE that grants the role. That is the reviewed
path, and it is the only path there should be.

## Alternatives rejected

**A separate `visible_presence` view for peer presence.** This is what the
original spec called for, written against a tree that did not yet have
`conversation_peers`. That view already is the boundary: SECURITY DEFINER, an
`auth.uid()` predicate in the WHERE, an explicit column list. A second definer
view doing the same job is a second place to get the predicate wrong, and 004 is
the record of what a decorative definer boundary costs. One boundary, one
predicate.

**Keeping `peer_available` beside the new column.** It would have been harmless,
and that is the argument against it. A column named "available" that four screens
read as "present" is the trap this change exists to close; leaving it means the
next reader has to rediscover which of two similar columns is the honest one.
Removing it made TypeScript enumerate every read site, which was the point.

**An RLS policy on `profiles` for peer presence.** RLS is row-level, so "you may
read the profile of somebody you have a thread with" hands over `token_balance`,
`phone_e164` and `date_of_birth` as well. This is exactly why 003 dropped the
discovery policy in favour of a view whose column list is the boundary.

**Renaming `is_available` to something like `is_listed`.** Correct, and not worth
the blast radius: eight call sites, two partial index definitions and a contract
assertion that pins the filter string verbatim. The column comment now says what
it means, which is where that belongs.

**Deriving presence from `presence_visible`, making the enum unnecessary.** A
visibility switch over a timestamp cannot express "here". The two answer different
questions and both are wanted.

## Consequences

A provider cannot edit their own headline after approval. There is no UI for that
today, so nothing breaks now; when it is asked for, the answer is an RPC that
re-runs the review rules, not a PATCH. Recorded here because the next person to
hit it will assume the guard is a mistake.

The backfill sets `presence = 'here'` for providers whose availability switch is
already on. It asserts a state on their behalf, which is why it is narrow. The
alternative is that every provider currently showing a dot silently stops showing
one on deploy. Worth a line in the release notes.

`conversation_summaries` was dropped and recreated, so its grants were re-stated.
A pgTAP assertion counts the `authenticated` SELECT grant, because losing it
empties every inbox in the product and nothing else would notice.

Two facts stored for one decision is a wart. It is a smaller wart than either
reverting 011's tested last-seen work or shipping two switches, and
`readPresence` is where the two are reconciled, in one place, failing closed.

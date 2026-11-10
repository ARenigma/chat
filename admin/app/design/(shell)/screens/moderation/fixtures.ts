import type { ModerationRow } from '@/app/(authenticated)/moderation/ModerationView';

export const NOW = new Date('2026-11-10T09:30:00+05:30').getTime();
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const id = (n: number) => `${(0xc0ffee00 + n * 104729).toString(16)}-77aa-4b8c-8d11-aabbccddeeff`;

export const REPORTS: ModerationRow[] = [
  {
    id: id(1), reason: 'child_safety', status: 'open', created_at: ago(1.5),
    detail: 'User is asking a minor for photos and to move the chat to another app.',
    evidence_body: 'hey you look so mature for 14, send me a pic? lets talk on telegram, dont tell your parents',
    subject_user_id: id(101), subject_role: 'provider', reports_against_subject: 3, conversation_id: id(201),
    evidence_surface: 'chat', evidence_author_name: 'Rohit S.',
  },
  {
    id: id(2), reason: 'self_harm', status: 'open', created_at: ago(6),
    detail: 'Listener told a caller there was no point going on.',
    evidence_body: null, subject_user_id: id(102), subject_role: 'provider', reports_against_subject: 1, conversation_id: id(202),
    evidence_surface: 'voice',
  },
  {
    id: id(3), reason: 'spam', status: 'open', created_at: ago(30),
    detail: 'Repeated promotional links in session chat.',
    evidence_body: 'Get 50% off my paid remedies, WhatsApp me on 98xxxxxx12 for the real reading',
    subject_user_id: id(103), subject_role: 'provider', reports_against_subject: 4, suspended_until: new Date(NOW + 3 * 86400_000).toISOString(),
    conversation_id: id(203), evidence_surface: 'chat',
  },
  {
    id: id(4), reason: 'harassment', status: 'open', created_at: ago(52),
    detail: null, evidence_body: 'Story comment: unacceptable language removed from the preview.',
    subject_user_id: id(104), subject_role: 'user', reports_against_subject: 1, story_id: id(301), evidence_surface: 'story_comment',
  },
  { id: id(5), reason: 'inappropriate_content', status: 'open', created_at: ago(120), detail: 'Profile photo is not appropriate.', subject_user_id: id(105), subject_role: 'provider', reports_against_subject: 1 },
  { id: id(6), reason: 'impersonation', status: 'open', created_at: ago(260), detail: 'Using another astrologer\'s name and certificate.', subject_user_id: id(106), subject_role: 'provider', reports_against_subject: 2 },
];

export const MANY: ModerationRow[] = Array.from({ length: 40 }, (_, i) => ({
  ...(REPORTS[(i % (REPORTS.length - 2)) + 2] as ModerationRow),
  id: id(400 + i),
  created_at: ago(2 + i * 9),
}));

export const LONG: ModerationRow[] = [
  {
    ...(REPORTS[0] as ModerationRow),
    detail: 'A very long free-text report from the reporter that goes on and on about what happened during the session, what was said, when the conversation was moved off platform, and what the reporter would like us to do about it, repeated for effect. '.repeat(3),
    evidence_body: 'Long evidence line '.repeat(40),
  },
];

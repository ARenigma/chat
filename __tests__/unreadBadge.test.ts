/**
 * The unread badge clears when the message is seen, locally, the way WhatsApp
 * and Bluesky do it, and the server counter agrees afterwards (migration 183
 * recounts on read). Before this the badge waited on a server counter that
 * only ever reset when the member SENT, so a read-but-unanswered thread kept
 * its badge forever (S22, 2026-10-03).
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('unread badge', () => {
  const realtime = read('src/api/realtime.ts');
  const migration = read('supabase/migrations/183_unread_count_sync_on_read.sql');

  it('is cleared in the conversation list cache as messages are seen', () => {
    expect(realtime).toMatch(
      /setQueryData<ConversationSummary\[\]>\(keys\.conversationList/,
    );
    // The count left is what has not been seen yet, not a blanket zero.
    expect(realtime).toMatch(/const left = unreadFromPeer\(list, selfId\)\.filter\(/);
  });

  it('is put back from the server when the read write fails', () => {
    const failure = realtime.slice(realtime.indexOf('if (error) {', realtime.indexOf('const left')));
    expect(failure.slice(0, 400)).toContain(
      'invalidateQueries({ queryKey: keys.conversationList })',
    );
  });

  it('is recounted by the server on every read, with grants closed', () => {
    expect(migration).toMatch(/after update of read_at on public\.messages/);
    expect(migration).toMatch(
      /revoke all on function public\.sync_unread_on_read\(\) from public, anon, authenticated;/,
    );
  });
});

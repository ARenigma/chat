/**
 * Removes story photos and videos from the `stories` bucket, through the
 * Storage API, which is the only thing that can.
 *
 * Deleting a storage.objects row in SQL removes the row and leaves the bytes:
 * "Deleting objects via a SQL query will not remove the object from the
 * bucket and will result in the object being orphaned." The Storage API's
 * delete removes both. So the database decides WHICH objects go
 * (story_objects_to_purge, migration 151) and this function makes them go.
 * https://supabase.com/docs/guides/storage/management/delete-objects
 *
 * The names come from claim_story_objects_to_purge, never from the plain
 * list. Listing and removing are two calls with nothing holding them
 * together, and a story created in between on a listed name lost its media to
 * this function (Greptile P1 on bb32af4): create_story retried with the id of
 * a story the provider had deleted. The claim records every name it returns
 * in story_media_released, under the lock create_story takes, and
 * create_story refuses every name recorded there, so no name this function
 * holds can become a live story's before remove() reaches it. A re-check here
 * would only narrow the gap; the claim closes it.
 *
 * Called by dispatch_story_media_purge (151) from pg_cron with the service
 * role key. It deletes in a bucket no client may delete in, so it takes a
 * service_role caller only, as send-push does: `verify_jwt` alone would let
 * any signed-in user trigger it.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'stories';
/**
 * Names per page and per remove(): "there is a limit of 1000 objects at a
 * time using the `remove` method" (the page above), and the RPC caps a page
 * at the same number.
 */
const PAGE = 1000;
/**
 * Pages per run. Ten minutes of deletes and an hour of expiries fit in one
 * page with room to spare; the cap is for a remove() that keeps failing on
 * some names, which would otherwise come back on every page forever.
 */
const MAX_PAGES = 10;

/** Length-then-byte comparison that does not stop at the first difference. */
function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  // Counts differences instead of returning at the first one.
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    diff += (x[i] ?? -1) === (y[i] ?? -2) ? 0 : 1;
  }
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return new Response('not configured', { status: 500 });
  }

  // Service-role only, the way send-push and send-engagement check it.
  // The exact service key, not a decoded role claim: a payload is not proof
  // without its signature, and this must hold even if verify_jwt is ever off
  // for a cron-invoked function.
  const auth = request.headers.get('Authorization') ?? '';
  const presented = auth.replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(presented, serviceKey)) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let removed = 0;
  let pages = 0;
  while (pages < MAX_PAGES) {
    const { data, error } = await db.rpc('claim_story_objects_to_purge', { p_limit: PAGE });
    if (error) {
      console.error('claim_story_objects_to_purge', error.message);
      return Response.json({ removed, pages, error: 'list failed' }, { status: 500 });
    }
    const names = ((data ?? []) as Array<{ object_name: unknown }>)
      .map(row => row.object_name)
      .filter((name): name is string => typeof name === 'string');
    if (names.length === 0) {
      break;
    }
    pages += 1;

    // A failed or partial remove orphans nothing: the claim lists objects
    // still present in the bucket, so whatever survives is listed again on
    // the next run. The release record only stops the id being reused.
    const { data: gone, error: removeError } = await db.storage.from(BUCKET).remove(names);
    if (removeError) {
      console.error('stories remove', removeError.message);
      return Response.json({ removed, pages, error: 'remove failed' }, { status: 500 });
    }
    const count = gone?.length ?? 0;
    removed += count;
    // A short page was the last one, and a page that removed nothing would
    // only be listed again.
    if (names.length < PAGE || count === 0) {
      break;
    }
  }

  return Response.json({ removed, pages });
});

import { QueryClient, QueryObserver } from '@tanstack/react-query';

/**
 * The premise the Blocked screen's branch order rests on.
 *
 * React Query v5 keeps the last data when a background refetch fails and sets
 * `isError` anyway. BlockedUsersScreen therefore checks for rows before it
 * checks for an error: the other way round, a refresh that failed after an
 * unblock hid every block still in force. contract.test.ts pins the order; this
 * pins why it is needed, so a library upgrade that changes the behaviour shows
 * up here rather than on somebody's safety screen.
 */
describe('a failed refresh of the blocked list', () => {
  it('keeps the rows it had and still reports the failure', async () => {
    // retry 1 as App.tsx configures it, with no delay so the test is quick.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
    });
    let offline = false;
    const observer = new QueryObserver(client, {
      queryKey: ['blocks', 'people'],
      queryFn: async () => {
        if (offline) {
          throw new Error('offline');
        }
        return [{ blocked_id: 'a' }, { blocked_id: 'b' }];
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await client.refetchQueries({ queryKey: ['blocks', 'people'] });
      expect(observer.getCurrentResult()).toMatchObject({
        isLoading: false,
        isError: false,
        data: [{ blocked_id: 'a' }, { blocked_id: 'b' }],
      });

      // What an unblock's invalidation does, on a network that fails twice.
      // Invalidating the `blocks` prefix reaches the named list too.
      offline = true;
      await client.invalidateQueries({ queryKey: ['blocks'] });
      expect(observer.getCurrentResult()).toMatchObject({
        isLoading: false,
        isError: true,
        data: [{ blocked_id: 'a' }, { blocked_id: 'b' }],
      });
    } finally {
      unsubscribe();
      client.clear();
    }
  });
});

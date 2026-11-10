import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { List, ListRow } from '@/components/ui/table';

export interface VersionHistoryItem {
  id: string;
  versionNumber: number;
  status: string;
  reason: string | null;
  /** Already formatted (published_at, else created_at). */
  whenLabel: string;
}

/** Dense version list: v-number, status chip, publish reason, timestamp. */
export function VersionHistory({ items }: { items: VersionHistoryItem[] }) {
  return (
    <section aria-labelledby="version-history-h" className="mt-8">
      <h2 id="version-history-h" className="mb-2 text-sm font-medium text-primary">
        Version history
      </h2>
      {items.length === 0 ? (
        <EmptyState
          cause="cold-start"
          title="No published versions yet"
          body="Publish a draft to create the first production version."
        />
      ) : (
        <List className="overflow-hidden rounded-lg border border-hairline bg-raised [&>*:last-child]:border-b-0">
          {items.map((v) => (
            <ListRow key={v.id} className="gap-3">
              <span className="w-10 shrink-0 font-mono text-xs text-primary">v{v.versionNumber}</span>
              <span className="w-24 shrink-0">
                <StatusBadge status={v.status} />
              </span>
              <span className="min-w-0 flex-1 truncate text-secondary" title={v.reason ?? undefined}>
                {v.reason ?? <span className="text-tertiary">No reason recorded</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-tertiary">{v.whenLabel}</span>
            </ListRow>
          ))}
        </List>
      )}
    </section>
  );
}

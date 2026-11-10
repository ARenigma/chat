import {
  Tray,
  MagnifyingGlass,
  WarningCircle,
  Lock,
  Lightning,
} from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/utils';

type EmptyCause = 'cold-start' | 'no-results' | 'load-failure' | 'permission' | 'error';

interface EmptyStateProps {
  cause?: EmptyCause;
  title?: string;
  body?: string;
  action?: React.ReactNode;
  /** A Phosphor icon element. Strings (the old emoji prop) are ignored: Linear-style states use line icons. */
  icon?: React.ReactNode;
  inline?: boolean;
  className?: string;
}

const DEFAULTS: Record<EmptyCause, { Icon: typeof Tray; title: string; body: string }> = {
  'cold-start': { Icon: Tray, title: 'Nothing here yet', body: 'Data will appear once the system is running.' },
  'no-results': { Icon: MagnifyingGlass, title: 'No results', body: 'Try adjusting your filters or check back later.' },
  'load-failure': { Icon: WarningCircle, title: 'Could not load data', body: 'There was a problem fetching this content. Reload or try again shortly.' },
  permission: { Icon: Lock, title: 'Access restricted', body: 'Your account does not have permission to view this.' },
  error: { Icon: Lightning, title: 'Something went wrong', body: 'An unexpected error occurred. Reload and try again.' },
};

export function EmptyState({ cause = 'cold-start', title, body, action, icon, inline, className }: EmptyStateProps) {
  const d = DEFAULTS[cause];
  const custom = icon && typeof icon !== 'string' ? icon : null;
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 px-6 py-12 text-center',
        !inline && 'rounded-lg border border-dashed border-hairline',
        className
      )}
    >
      <span className="mb-2 inline-flex size-9 items-center justify-center rounded-md border border-hairline bg-raised text-secondary">
        {custom ?? <d.Icon size={18} aria-hidden="true" />}
      </span>
      <p className="text-sm font-medium text-primary">{title ?? d.title}</p>
      <p className="max-w-xs text-sm text-secondary">{body ?? d.body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

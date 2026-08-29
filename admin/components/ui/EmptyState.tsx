type EmptyCause = 'cold-start' | 'no-results' | 'load-failure' | 'permission' | 'error';

interface EmptyStateProps {
  cause?: EmptyCause;
  title?: string;
  body?: string;
  action?: React.ReactNode;
  icon?: string;
}

const DEFAULTS: Record<EmptyCause, { icon: string; title: string; body: string }> = {
  'cold-start': {
    icon: '📭',
    title: 'Nothing here yet',
    body: 'Data will appear once the system is running.',
  },
  'no-results': {
    icon: '🔍',
    title: 'No results',
    body: 'Try adjusting your filters or check back later.',
  },
  'load-failure': {
    icon: '⚠️',
    title: 'Could not load data',
    body: 'There was a problem fetching this content. Reload or try again shortly.',
  },
  'permission': {
    icon: '🔒',
    title: 'Access restricted',
    body: 'Your account does not have permission to view this.',
  },
  'error': {
    icon: '⚡',
    title: 'Something went wrong',
    body: 'An unexpected error occurred. Reload and try again.',
  },
};

export function EmptyState({ cause = 'cold-start', title, body, action, icon }: EmptyStateProps) {
  const d = DEFAULTS[cause];
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? d.icon}</div>
      <p className="empty-state-title">{title ?? d.title}</p>
      <p className="empty-state-body">{body ?? d.body}</p>
      {action}
    </div>
  );
}

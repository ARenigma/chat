import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type EmptyCause = 'cold-start' | 'no-results' | 'load-failure' | 'permission' | 'error';

interface EmptyStateProps {
  cause?: EmptyCause;
  title?: string;
  body?: string;
  action?: React.ReactNode;
  icon?: string;
  inline?: boolean;
}

const DEFAULTS: Record<EmptyCause, { icon: string; title: string; body: string }> = {
  'cold-start': { icon: '📭', title: 'Nothing here yet', body: 'Data will appear once the system is running.' },
  'no-results': { icon: '🔍', title: 'No results', body: 'Try adjusting your filters or check back later.' },
  'load-failure': { icon: '⚠️', title: 'Could not load data', body: 'There was a problem fetching this content. Reload or try again shortly.' },
  'permission': { icon: '🔒', title: 'Access restricted', body: 'Your account does not have permission to view this.' },
  'error': { icon: '⚡', title: 'Something went wrong', body: 'An unexpected error occurred. Reload and try again.' },
};

export function EmptyState({ cause = 'cold-start', title, body, action, icon, inline }: EmptyStateProps) {
  const d = DEFAULTS[cause];
  const content = (
    <div className="flex flex-col items-center text-center py-10 px-6 gap-2">
      <span className="text-3xl" role="img" aria-hidden="true">{icon ?? d.icon}</span>
      <p className="font-semibold text-sm mt-1">{title ?? d.title}</p>
      <p className="text-sm text-muted-foreground max-w-xs">{body ?? d.body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );

  if (inline) return content;

  return (
    <Card className={cn('border-dashed')}>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}

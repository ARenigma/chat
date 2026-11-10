import { Info, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/utils';

/** Inline banner for load errors and read-only notices. Tokens only; role=alert for errors. */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'danger';
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === 'danger' ? WarningCircle : Info;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
        tone === 'danger'
          ? 'border-danger-dot/40 bg-danger-subtle text-danger'
          : 'border-hairline bg-raised text-secondary',
        className
      )}
    >
      <Icon size={16} className="mt-px shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

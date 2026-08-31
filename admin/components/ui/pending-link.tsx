'use client';

import Link, { type LinkProps } from 'next/link';
import { useLinkStatus } from 'next/link';
import { cn } from '@/lib/utils';

/** Inner component — must be a child of <Link> to read useLinkStatus */
function PendingIndicator({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cn('link-hint', pending && 'is-pending', className)}
      aria-hidden="true"
    />
  );
}

interface PendingLinkProps extends Omit<LinkProps, 'className'> {
  className?: string;
  children: React.ReactNode;
}

/**
 * Link that shows an inline spinner while navigation is pending.
 * Uses Next.js 15 useLinkStatus — no fake loading states.
 * Fixed-width spinner slot prevents layout shift.
 */
export function PendingLink({ children, className, ...props }: PendingLinkProps) {
  return (
    <Link {...props} className={cn('inline-flex items-center gap-1.5', className)}>
      {children}
      <PendingIndicator />
    </Link>
  );
}

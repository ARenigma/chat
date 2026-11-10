'use client';

import * as React from 'react';
import { useShellCrumbs, type Crumb } from '@/components/layout/shell-context';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** Description under the title. `description` is the new name; `subtitle` is kept for existing pages. */
  description?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Shown in the shell's top bar (not above the title), like Linear. */
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}

/** Page title block: 20px/600 title, 13px secondary description, actions on the right. */
export function PageHeader({ title, description, subtitle, breadcrumbs, actions, className }: PageHeaderProps) {
  useShellCrumbs(breadcrumbs);
  const desc = description ?? subtitle;
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-primary">{title}</h1>
        {desc && <p className="mt-1 text-sm text-secondary">{desc}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

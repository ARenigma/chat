'use client';

import { cn } from '@/lib/utils';

interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * Quick filter chips (Linear's filter bar, flattened): one choice at a time,
 * 24px pills, selected one on the selected tint. Buttons, so Tab and Space work.
 */
export function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: ChipOption<T>[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex items-center gap-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-100',
              on
                ? 'border-hairline-strong bg-selected text-primary'
                : 'border-transparent text-secondary hover:bg-hover hover:text-primary'
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="text-tertiary tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

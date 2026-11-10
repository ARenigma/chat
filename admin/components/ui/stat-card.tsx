'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { ArrowDownRight, ArrowUpRight } from '@phosphor-icons/react/dist/ssr';
import CountUp from '@/components/react-bits/CountUp';
import SpotlightCard from '@/components/react-bits/SpotlightCard';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

// ECharts is heavy and most stat cards have no sparkline: load it only when one is rendered.
const Sparkline = dynamic(() => import('@/components/ui/sparkline'), { ssr: false });

interface StatCardProps {
  label: string;
  /** A number animates with CountUp; any other node renders as-is. */
  value: React.ReactNode;
  /** Secondary line under the value (kept for existing pages). */
  sub?: React.ReactNode;
  /** Percent change; positive is good unless `deltaInverse`. */
  delta?: number;
  deltaInverse?: boolean;
  deltaLabel?: string;
  /** Trend values rendered as a sparkline on the right. */
  trend?: number[];
  /** CountUp formatting: decimals, prefix, suffix, thousands separator. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Thousands separator; 'en-IN' groups lakh/crore style. Defaults to ','. */
  separator?: string;
  className?: string;
}

/**
 * Summary card: 12px label, 24px tabular value (CountUp on first view only),
 * optional delta chip and sparkline. SpotlightCard supplies the one subtle
 * cursor-follow hover that Linear would have, no more.
 */
export function StatCard({
  label,
  value,
  sub,
  delta,
  deltaInverse,
  deltaLabel,
  trend,
  decimals,
  prefix,
  suffix,
  separator = ',',
  className,
}: StatCardProps) {
  const { resolvedTheme } = useTheme();
  const good = delta === undefined ? undefined : deltaInverse ? delta < 0 : delta > 0;
  return (
    <SpotlightCard
      data-slot="stat-card"
      spotlightColor="var(--text-primary)"
      intensity={0.05}
      borderGlow={0.35}
      flare={false}
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      className={cn('rounded-lg! p-4!', className)}
      style={{
        // Re-skin: the registry card hard-codes its surface/border/shadow; point them at tokens.
        ['--spotlight-card-surface' as string]: 'var(--raised)',
        ['--spotlight-card-border' as string]: 'var(--border-hairline)',
        ['--spotlight-card-shadow' as string]: 'none',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-secondary">{label}</p>
          <p className="mt-1.5 text-2xl leading-8 font-semibold tracking-[-0.02em] text-primary tabular-nums">
            {typeof value === 'number' ? (
              <CountUp to={value} duration={0.6} separator={separator} decimals={decimals} prefix={prefix} suffix={suffix} trigger="load" />
            ) : (
              value
            )}
          </p>
        </div>
        {trend && trend.length > 1 && (
          <div className="w-24 shrink-0">
            <Sparkline values={trend} label={`${label} trend`} />
          </div>
        )}
      </div>
      {(delta !== undefined || sub) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium tabular-nums',
                good ? 'text-success' : 'text-danger'
              )}
            >
              {delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {(deltaLabel || sub) && <span className="text-tertiary">{deltaLabel ?? sub}</span>}
          {delta !== undefined && sub && deltaLabel && <span className="text-tertiary">{sub}</span>}
        </div>
      )}
    </SpotlightCard>
  );
}

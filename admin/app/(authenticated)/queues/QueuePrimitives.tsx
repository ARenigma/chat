'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { ListRow } from '@/components/ui/table';
import { StatusIcon, type StatusIconState } from '@/components/ui/status-icon';
import type { Tone } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** Search box + keyboard hints, full-bleed under the tabs like Linear's filter bar. */
export function QueueToolbar({
  label,
  value,
  onChange,
  summary,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  summary: string;
}) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-hairline px-(--page-pad)">
      <div className="relative w-full max-w-56">
        <MagnifyingGlass size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary" />
        <Input
          aria-label={label}
          placeholder="Filter…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 pl-8"
        />
      </div>
      <span className="ml-auto flex items-center gap-3 text-xs text-tertiary">
        <span className="tabular-nums">{summary}</span>
        <span className="hidden items-center gap-1.5 md:flex" aria-hidden="true">
          <KbdGroup><Kbd>J</Kbd><Kbd>K</Kbd></KbdGroup> move
          <Kbd>↵</Kbd> open
        </span>
      </span>
    </div>
  );
}

/**
 * One triage row (36px): status ring, mono id, subject, optional chips, age.
 * The main area is a single button that opens the detail panel; hover actions
 * are siblings of it, so they never nest interactive elements and they also
 * appear when the row has keyboard focus.
 */
export function QueueRow({
  ring,
  tone,
  id,
  title,
  meta,
  chips,
  age,
  selected,
  onOpen,
  actions,
  label,
}: {
  ring: StatusIconState;
  tone: Tone;
  id: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  chips?: React.ReactNode;
  age: string;
  selected: boolean;
  onOpen: () => void;
  actions?: React.ReactNode;
  label: string;
}) {
  return (
    <ListRow selected={selected} className="group/row relative gap-0 px-0">
      <button
        type="button"
        data-row-main
        aria-label={label}
        onClick={onOpen}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-none px-4 text-left outline-offset-[-2px]"
      >
        <StatusIcon state={ring} tone={tone} />
        <span className="w-[68px] shrink-0 font-mono text-xs text-tertiary">{id}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-primary">
          {title}
          {meta && <span className="ml-2 font-normal text-tertiary">{meta}</span>}
        </span>
        {chips && <span className="hidden shrink-0 items-center gap-1.5 md:flex">{chips}</span>}
        <span
          className={cn(
            'w-14 shrink-0 text-right text-xs text-tertiary tabular-nums',
            actions && 'group-focus-within/row:opacity-0 group-hover/row:opacity-0'
          )}
        >
          {age}
        </span>
      </button>
      {actions && (
        <div className="absolute top-1/2 right-3 -translate-y-1/2 rounded-sm bg-raised opacity-0 ring-1 ring-hairline group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[role=alert]]:opacity-100">
          {actions}
        </div>
      )}
    </ListRow>
  );
}

/**
 * Right-hand detail panel. j/k and the arrow keys step through the list while it
 * is open (ignored inside fields); Escape and the close button come from Sheet.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  position,
  onStep,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  position?: { index: number; total: number };
  onStep: (dir: 1 | -1) => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select')) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      onStep(1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      onStep(-1);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-[420px]" onKeyDown={onKeyDown}>
        <SheetHeader className="gap-1 border-b border-hairline p-4 pr-12">
          <div className="mb-1 flex items-center gap-1 text-xs text-tertiary">
            <Button variant="ghost" size="icon-xs" aria-label="Previous item" onClick={() => onStep(-1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Next item" onClick={() => onStep(1)}>
              <ArrowDown />
            </Button>
            {position && (
              <span className="ml-1 tabular-nums">
                {position.index + 1} / {position.total}
              </span>
            )}
          </div>
          <SheetTitle className="truncate text-md tracking-[-0.01em] text-primary">{title}</SheetTitle>
          <SheetDescription className="text-sm text-secondary">{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        <SheetFooter className="border-t border-hairline p-4">{footer}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Move focus between row buttons with j/k or the arrow keys (not while typing in a field). */
export function onListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const t = e.target as HTMLElement;
  if (t.closest('input,textarea,select')) return;
  const dir = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
  if (!dir) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row-main]'));
  const current = t.closest('[data-slot="list-row"]')?.querySelector<HTMLElement>('[data-row-main]');
  const i = current ? rows.indexOf(current) : -1;
  const next = rows[i + dir] ?? (i === -1 ? rows[0] : undefined);
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

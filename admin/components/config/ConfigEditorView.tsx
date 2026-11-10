'use client';

import * as React from 'react';
import { ArrowRight, CaretRight } from '@phosphor-icons/react/dist/ssr';
import type { DomainDef } from '@/lib/config-registry';
import type { ConfigDiffRow } from '@/lib/config-view';
import { GuidedForm } from '@/components/config/GuidedForm';
import { Button, AsyncButton } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Dot, type Tone } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

export const PUBLISH_PHRASE = 'publish to production';

export interface PublishDialogState {
  open: boolean;
  reason: string;
  confirmPhrase: string;
  error: string | null;
  pending: boolean;
  onReasonChange: (v: string) => void;
  onPhraseChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export interface ConfigEditorViewProps {
  domainName: string;
  /** Registry definition; null renders the raw JSON editor instead of the guided form. */
  domainDef: DomainDef | null;
  payload: Record<string, unknown>;
  onPayloadChange: (next: Record<string, unknown>) => void;
  jsonText: string;
  jsonError: string | null;
  onJsonChange: (v: string) => void;
  validationErrors: string[];
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  /** Changes from live; empty until a draft has been saved. */
  diff: ConfigDiffRow[];
  isDirty: boolean;
  hasSavedDraft: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onOpenPublish: () => void;
  publish: PublishDialogState;
}

/** Removed / added value chips, token tints (replaces the legacy .diff-old / .diff-new classes). */
function DiffChange({ oldText, newText, className }: { oldText: string; newText: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      <span className="rounded-xs bg-danger-subtle px-1.5 py-0.5 font-mono text-xs text-danger line-through decoration-danger/50">
        <span className="sr-only">Was </span>
        {oldText}
      </span>
      <ArrowRight size={12} aria-hidden="true" className="shrink-0 text-tertiary" />
      <span className="rounded-xs bg-success-subtle px-1.5 py-0.5 font-mono text-xs text-success">
        <span className="sr-only">Now </span>
        {newText}
      </span>
    </span>
  );
}

function DiffList({ diff, className }: { diff: ConfigDiffRow[]; className?: string }) {
  return (
    <ul className={cn('divide-y divide-hairline', className)}>
      {diff.map((row) => (
        <li key={row.key} className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
          <span className="min-w-0 text-sm text-body sm:w-52 sm:shrink-0">{row.label}</span>
          <DiffChange oldText={row.oldText} newText={row.newText} />
        </li>
      ))}
    </ul>
  );
}

function JsonField({
  id,
  label,
  rows,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  rows: number;
  value: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="font-mono text-xs"
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Presentation of the config editor: guided settings rows, advanced JSON, diff against live,
 * sticky save bar and the publish confirmation. Data, drafts and API calls live in ConfigVersionEditor.
 */
export function ConfigEditorView(p: ConfigEditorViewProps) {
  const canSave = p.validationErrors.length === 0 && !p.jsonError && !p.saving;
  const canPublish = p.hasSavedDraft && !p.isDirty;
  const phraseOk = p.publish.confirmPhrase === PUBLISH_PHRASE;

  // Keyboard hints in the save bar are real: ⌘/Ctrl+S saves, ⌘/Ctrl+Enter opens the publish confirmation.
  const { onSave, onOpenPublish } = p;
  const publishOpen = p.publish.open;
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || publishOpen) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSave && p.isDirty) onSave();
      } else if (e.key === 'Enter' && canPublish) {
        e.preventDefault();
        onOpenPublish();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSave, canPublish, publishOpen, p.isDirty, onSave, onOpenPublish]);

  const showBar = p.isDirty || !!p.saveError || p.hasSavedDraft;
  let barTone: Tone = 'neutral';
  let barText = '';
  if (p.saveError) {
    barTone = 'danger';
    barText = p.saveError;
  } else if (p.jsonError) {
    barTone = 'danger';
    barText = p.jsonError;
  } else if (p.validationErrors.length > 0 && p.isDirty) {
    barTone = 'danger';
    barText = p.validationErrors[0] ?? '';
  } else if (p.isDirty) {
    barTone = 'warning';
    barText = 'Unsaved changes';
  } else {
    barTone = 'success';
    barText = 'Draft saved, ready to publish';
  }

  return (
    <div className="flex flex-col gap-4">
      {p.domainDef ? (
        <GuidedForm
          domain={p.domainDef}
          payload={p.payload}
          onChange={p.onPayloadChange}
          errors={p.validationErrors}
        />
      ) : (
        <div className="rounded-lg border border-hairline bg-raised p-4">
          <JsonField
            id="payload-editor"
            label="Edit payload (JSON)"
            rows={16}
            value={p.jsonText}
            error={p.jsonError}
            onChange={p.onJsonChange}
          />
        </div>
      )}

      {p.domainDef && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 gap-1 text-secondary"
            aria-expanded={p.showAdvanced}
            aria-controls="advanced-json"
            onClick={p.onToggleAdvanced}
          >
            <CaretRight size={12} className={cn(p.showAdvanced && 'rotate-90')} aria-hidden="true" />
            Advanced: raw JSON
          </Button>
          {p.showAdvanced && (
            <div id="advanced-json" className="mt-2 rounded-lg border border-hairline bg-raised p-4">
              <JsonField
                id="payload-json"
                label="Raw JSON, edits sync to the guided controls"
                rows={12}
                value={p.jsonText}
                error={p.jsonError}
                onChange={p.onJsonChange}
              />
              {p.validationErrors.length > 0 && (
                <ul className="mt-3 flex flex-col gap-0.5">
                  {p.validationErrors.map((e, i) => (
                    <li key={i} className="text-xs text-danger">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {p.hasSavedDraft && p.diff.length > 0 && (
        <section aria-labelledby="diff-h" className="overflow-hidden rounded-lg border border-hairline bg-raised">
          <div className="flex h-9 items-center justify-between border-b border-hairline px-4">
            <h2 id="diff-h" className="text-sm font-medium text-primary">
              Changes from live
            </h2>
            <span className="text-xs text-tertiary">
              {p.diff.length} {p.diff.length === 1 ? 'field' : 'fields'}
            </span>
          </div>
          <DiffList diff={p.diff} />
        </section>
      )}

      {showBar && (
        <div
          role="region"
          aria-label="Save changes"
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-hairline-strong bg-raised py-2 pr-2 pl-4 shadow-pop"
        >
          <span
            role={barTone === 'danger' ? 'alert' : 'status'}
            className={cn('flex min-w-0 items-center gap-2 text-sm', barTone === 'danger' ? 'text-danger' : 'text-body')}
          >
            <Dot tone={barTone} />
            <span className="min-w-0">{barText}</span>
          </span>
          <div className="flex items-center gap-2">
            {p.isDirty && (
              <Button type="button" variant="secondary" size="sm" onClick={p.onDiscard}>
                Discard
              </Button>
            )}
            {p.isDirty && (
              <AsyncButton
                size="sm"
                variant={p.hasSavedDraft || canPublish ? 'secondary' : 'default'}
                pending={p.saving}
                disabled={p.validationErrors.length > 0 || !!p.jsonError}
                onClick={onSave}
              >
                Save draft
                <KbdGroup aria-hidden="true">
                  <Kbd className="border-transparent bg-on-accent/20 text-on-accent">⌘</Kbd>
                  <Kbd className="border-transparent bg-on-accent/20 text-on-accent">S</Kbd>
                </KbdGroup>
              </AsyncButton>
            )}
            {canPublish && (
              <Button type="button" size="sm" onClick={p.onOpenPublish}>
                Publish to production…
                <KbdGroup aria-hidden="true">
                  <Kbd className="border-transparent bg-on-accent/20 text-on-accent">⌘</Kbd>
                  <Kbd className="border-transparent bg-on-accent/20 text-on-accent">↵</Kbd>
                </KbdGroup>
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={p.publish.open} onOpenChange={(v) => !v && p.publish.onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish to production</DialogTitle>
            <DialogDescription>
              This immediately replaces the active config for &ldquo;{p.domainName}&rdquo; for all users.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {p.diff.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-hairline bg-surface">
                <DiffList diff={p.diff} />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="publish-reason">Reason for this change</Label>
              <Input
                id="publish-reason"
                value={p.publish.reason}
                onChange={(e) => p.publish.onReasonChange(e.target.value)}
                placeholder="e.g. Increase chat rate per Q3 pricing review"
                disabled={p.publish.pending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-phrase">
                Type <strong className="font-semibold text-primary">{PUBLISH_PHRASE}</strong> to confirm
              </Label>
              <Input
                id="confirm-phrase"
                value={p.publish.confirmPhrase}
                onChange={(e) => p.publish.onPhraseChange(e.target.value)}
                placeholder={PUBLISH_PHRASE}
                aria-invalid={p.publish.confirmPhrase !== '' && !phraseOk}
                disabled={p.publish.pending}
                autoComplete="off"
              />
            </div>

            {p.publish.error && (
              <p role="alert" className="rounded-md border border-danger-dot/40 bg-danger-subtle px-3 py-2 text-sm text-danger">
                {p.publish.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={p.publish.pending}>
                Cancel
              </Button>
            </DialogClose>
            <AsyncButton
              pending={p.publish.pending}
              disabled={!phraseOk || !p.publish.reason.trim()}
              onClick={p.publish.onConfirm}
            >
              Publish
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

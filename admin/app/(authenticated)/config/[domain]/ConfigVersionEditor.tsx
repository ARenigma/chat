'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import {
  type DomainDef,
  formatDisplayValue,
  getDomain,
  validatePayload,
} from '@/lib/config-registry';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';
import { useMutation } from '@/lib/hooks/useMutation';
import { cn } from '@/lib/utils';

interface ConfigVersion {
  id: string;
  version_number: number;
  status: string;
  payload: unknown;
  published_at: string | null;
  created_at: string;
  publish_reason: string | null;
}

interface Props {
  domain: string;
  activeVersion: ConfigVersion | null;
  draftVersion: ConfigVersion | null;
}

function buildDiff(
  active: Record<string, unknown>,
  draft: Record<string, unknown>,
  domainDef: DomainDef
): Array<{ key: string; label: string; old: unknown; new: unknown }> {
  const changes: Array<{ key: string; label: string; old: unknown; new: unknown }> = [];
  for (const field of domainDef.fields) {
    const oldVal = active[field.key];
    const newVal = draft[field.key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ key: field.key, label: field.label, old: oldVal, new: newVal });
    }
  }
  return changes;
}

export function ConfigVersionEditor({ domain, activeVersion, draftVersion }: Props) {
  const router = useRouter();
  const toast = useToast();
  const domainDef = getDomain(domain);

  const seedPayload = (draftVersion?.payload ?? activeVersion?.payload ?? {}) as Record<string, unknown>;
  const [payload, setPayload] = useState<Record<string, unknown>>(seedPayload);
  const [isDirty, setIsDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(seedPayload, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftVersion?.id ?? null);

  const [showPublish, setShowPublish] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);

  const activePayload = (activeVersion?.payload ?? {}) as Record<string, unknown>;

  function handlePayloadChange(next: Record<string, unknown>) {
    setPayload(next);
    setJsonText(JSON.stringify(next, null, 2));
    setIsDirty(true);
    setSavedDraftId(null);
  }

  function handleJsonChange(v: string) {
    setJsonText(v);
    setIsDirty(true);
    setSavedDraftId(null);
    try {
      const parsed = JSON.parse(v);
      setPayload(parsed as Record<string, unknown>);
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON — fix before saving.');
    }
  }

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty && savedDraftId == null) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, savedDraftId]);

  const validationErrors = domainDef ? validatePayload(domainDef, payload) : [];

  const saveMutation = useMutation(
    async () => {
      if (validationErrors.length > 0) throw new Error(validationErrors[0]);
      if (jsonError) throw new Error(jsonError);

      const res = await fetch(`/api/config/${domain}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string; version_number: number };
    },
    {
      onSuccess: (data) => {
        setSavedDraftId(data.id);
        setIsDirty(false);
        toast.success('Draft saved');
      },
      onError: (err) => toast.error(`Save failed: ${err}`),
    }
  );

  const publishMutation = useMutation(
    async () => {
      if (confirmPhrase !== 'publish to production') throw new Error('Type the exact phrase to confirm.');
      if (!reason.trim()) throw new Error('Reason is required.');

      const res = await fetch(`/api/config/${domain}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft_version_id: savedDraftId,
          confirmation_phrase: confirmPhrase,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    {
      onSuccess: () => {
        setShowPublish(false);
        toast.success('Published to production');
        router.refresh();
      },
      onError: (err) => setPublishError(err),
    }
  );

  const diff =
    savedDraftId != null && domainDef
      ? buildDiff(activePayload, payload, domainDef)
      : [];

  function closePublish() {
    setShowPublish(false);
    setConfirmPhrase('');
    setReason('');
    setPublishError(null);
    publishMutation.reset();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Guided form */}
      {domainDef ? (
        <GuidedForm domain={domainDef} payload={payload} onChange={handlePayloadChange} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payload-editor">Edit payload (JSON)</Label>
          <Textarea
            id="payload-editor"
            value={jsonText}
            rows={16}
            className={cn('font-mono text-sm', jsonError && 'border-destructive')}
            onChange={(e) => handleJsonChange(e.target.value)}
            spellCheck={false}
          />
          {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
        </div>
      )}

      {/* Advanced JSON accordion */}
      {domainDef && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-1 text-muted-foreground"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <ChevronRight
              size={14}
              className={cn('transition-transform duration-150', showAdvanced && 'rotate-90')}
            />
            Advanced: raw JSON
          </Button>
          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-1.5 pt-3">
                  <Label htmlFor="payload-json">
                    Raw JSON — edits sync to guided controls
                  </Label>
                  <Textarea
                    id="payload-json"
                    value={jsonText}
                    rows={12}
                    className={cn('font-mono text-sm', jsonError && 'border-destructive')}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    spellCheck={false}
                  />
                  {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
                  {validationErrors.length > 0 && (
                    <div className="flex flex-col gap-0.5 mt-1">
                      {validationErrors.map((e, i) => (
                        <p key={i} className="text-sm text-destructive">{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Diff view after save */}
      <AnimatePresence>
        {savedDraftId != null && diff.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-lg border bg-card overflow-hidden"
          >
            <div className="px-4 py-3 border-b bg-muted/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Changes from live
              </p>
            </div>
            <div className="divide-y">
              {diff.map(({ key, label, old: oldVal, new: newVal }) => {
                const field = domainDef?.fields.find((f) => f.key === key);
                return (
                  <div key={key} className="px-4 py-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
                    <p className="text-sm font-medium min-w-0 sm:w-40 shrink-0">{label}</p>
                    <p className="diff-old text-sm">
                      {field ? formatDisplayValue(field, oldVal) : JSON.stringify(oldVal)}
                    </p>
                    <span className="hidden sm:inline text-muted-foreground">→</span>
                    <p className="diff-new text-sm">
                      {field ? formatDisplayValue(field, newVal) : JSON.stringify(newVal)}
                    </p>
                  </div>
                );
              })}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Save bar */}
      <AnimatePresence>
        {(isDirty || saveMutation.error) && (
          <motion.div
            className="save-bar"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            <span className="text-sm text-muted-foreground">
              {saveMutation.error
                ? saveMutation.error
                : savedDraftId == null
                ? 'Unsaved changes'
                : 'Draft saved — ready to publish'}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {isDirty && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPayload(seedPayload);
                    setJsonText(JSON.stringify(seedPayload, null, 2));
                    setIsDirty(false);
                    setSavedDraftId(draftVersion?.id ?? null);
                  }}
                >
                  Discard
                </Button>
              )}
              <AsyncButton
                size="sm"
                pending={saveMutation.loading}
                disabled={validationErrors.length > 0 || !!jsonError}
                onClick={() => { saveMutation.mutate(undefined).catch(() => undefined); }}
              >
                Save draft
              </AsyncButton>
              {savedDraftId != null && (
                <Button
                  size="sm"
                  className="bg-[var(--bg-accent)] text-white hover:bg-[var(--bg-accent-strong)]"
                  onClick={() => setShowPublish(true)}
                >
                  Publish to production…
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Publish confirm dialog */}
      <Dialog open={showPublish} onOpenChange={(v) => !v && closePublish()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish to production</DialogTitle>
            <DialogDescription>
              This immediately replaces the active config for &ldquo;{domainDef?.name ?? domain}&rdquo; for all users.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Diff summary */}
            {diff.length > 0 && (
              <div className="rounded-md border divide-y max-h-48 overflow-y-auto text-sm">
                {diff.map(({ key, label, old: oldVal, new: newVal }) => {
                  const field = domainDef?.fields.find((f) => f.key === key);
                  return (
                    <div key={key} className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="font-medium text-xs w-full text-muted-foreground">{label}</span>
                      <span className="diff-old text-xs">
                        {field ? formatDisplayValue(field, oldVal) : JSON.stringify(oldVal)}
                      </span>
                      <span className="text-muted-foreground text-xs">→</span>
                      <span className="diff-new text-xs">
                        {field ? formatDisplayValue(field, newVal) : JSON.stringify(newVal)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="publish-reason">Reason for this change</Label>
              <Input
                id="publish-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Increase chat rate per Q3 pricing review"
                disabled={publishMutation.loading}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-phrase">
                Type <strong>publish to production</strong> to confirm
              </Label>
              <Input
                id="confirm-phrase"
                value={confirmPhrase}
                onChange={(e) => {
                  setConfirmPhrase(e.target.value);
                  setPublishError(null);
                }}
                placeholder="publish to production"
                aria-invalid={confirmPhrase !== '' && confirmPhrase !== 'publish to production'}
                disabled={publishMutation.loading}
                autoComplete="off"
              />
            </div>

            {publishError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {publishError}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={publishMutation.loading}>Cancel</Button>
            </DialogClose>
            <AsyncButton
              className="bg-[var(--bg-accent)] text-white hover:bg-[var(--bg-accent-strong)]"
              pending={publishMutation.loading}
              disabled={confirmPhrase !== 'publish to production' || !reason.trim()}
              onClick={() => { publishMutation.mutate(undefined).catch(() => undefined); }}
            >
              Publish
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

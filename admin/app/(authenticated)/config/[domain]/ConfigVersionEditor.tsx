'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  type DomainDef,
  formatDisplayValue,
  getDomain,
  validatePayload,
} from '@/lib/config-registry';
import { GuidedForm } from '@/components/config/GuidedForm';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useMutation } from '@/lib/hooks/useMutation';

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
      changes.push({
        key: field.key,
        label: field.label,
        old: oldVal,
        new: newVal,
      });
    }
  }
  return changes;
}

export function ConfigVersionEditor({ domain, activeVersion, draftVersion }: Props) {
  const router = useRouter();
  const toast = useToast();
  const domainDef = getDomain(domain);

  const seedPayload = (draftVersion?.payload ?? activeVersion?.payload ?? {}) as Record<
    string,
    unknown
  >;
  const [payload, setPayload] = useState<Record<string, unknown>>(seedPayload);
  const [isDirty, setIsDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(seedPayload, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftVersion?.id ?? null);

  // Publish modal state
  const [showPublish, setShowPublish] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);

  // Track active payload (from DB) for diff
  const activePayload = (activeVersion?.payload ?? {}) as Record<string, unknown>;

  // Keep JSON textarea in sync when guided form changes
  function handlePayloadChange(next: Record<string, unknown>) {
    setPayload(next);
    setJsonText(JSON.stringify(next, null, 2));
    setIsDirty(true);
    setSavedDraftId(null);
  }

  // When JSON editor changes, try to sync back to guided form
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

  // Warn on navigation away when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty && savedDraftId == null) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, savedDraftId]);

  // Validation errors
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

  // Diff from active
  const diff =
    savedDraftId != null && domainDef
      ? buildDiff(activePayload, payload, domainDef)
      : [];

  return (
    <div>
      {/* Guided form */}
      {domainDef ? (
        <section style={{ marginBottom: '1.5rem' }}>
          <GuidedForm
            domain={domainDef}
            payload={payload}
            onChange={handlePayloadChange}
          />
        </section>
      ) : (
        /* Fallback: raw JSON for unknown domains */
        <section style={{ marginBottom: '1.5rem' }}>
          <div className="field">
            <label className="field-label" htmlFor="payload-editor">Edit payload (JSON)</label>
            <Textarea
              id="payload-editor"
              value={jsonText}
              mono
              rows={16}
              error={jsonError != null}
              onChange={(e) => handleJsonChange(e.target.value)}
              spellCheck={false}
            />
            {jsonError && <p className="field-error">{jsonError}</p>}
          </div>
        </section>
      )}

      {/* Advanced JSON */}
      {domainDef && (
        <section style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ gap: '0.375rem' }}
          >
            <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
            Advanced: raw JSON
          </button>
          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ paddingTop: '0.75rem' }}>
                  <div className="field">
                    <label className="field-label" htmlFor="payload-json">
                      Raw JSON — edits sync to guided controls
                    </label>
                    <Textarea
                      id="payload-json"
                      value={jsonText}
                      mono
                      rows={12}
                      error={jsonError != null}
                      onChange={(e) => handleJsonChange(e.target.value)}
                      spellCheck={false}
                    />
                    {jsonError && <p className="field-error">{jsonError}</p>}
                    {validationErrors.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        {validationErrors.map((e, i) => (
                          <p key={i} className="field-error">{e}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {/* Inline diff after save */}
      <AnimatePresence>
        {savedDraftId != null && diff.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ marginBottom: '1.5rem' }}
          >
            <p className="section-label" style={{ marginBottom: '0.5rem' }}>Changes from live</p>
            <div className="diff-wrap">
              {diff.map(({ key, label, old: oldVal, new: newVal }) => {
                const field = domainDef?.fields.find((f) => f.key === key);
                return (
                  <div key={key} className="diff-row">
                    <p className="diff-row-label">{label}</p>
                    <p className="diff-old">
                      {field ? formatDisplayValue(field, oldVal) : JSON.stringify(oldVal)}
                    </p>
                    <p className="diff-new">
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
            <span className="save-bar-info">
              {saveMutation.error
                ? saveMutation.error
                : savedDraftId == null
                ? 'Unsaved changes'
                : 'Draft saved — ready to publish'}
            </span>
            <div className="save-bar-actions">
              {isDirty && (
                <Button
                  variant="secondary"
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
              <Button
                variant="primary"
                size="sm"
                loading={saveMutation.loading}
                disabled={validationErrors.length > 0 || !!jsonError}
                onClick={() => { saveMutation.mutate(undefined).catch(() => undefined); }}
              >
                Save draft
              </Button>
              {savedDraftId != null && (
                <Button
                  variant="accent"
                  size="sm"
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
      <Dialog
        open={showPublish}
        onClose={() => {
          setShowPublish(false);
          setConfirmPhrase('');
          setReason('');
          setPublishError(null);
          publishMutation.reset();
        }}
        title="Publish to production"
        description={`This immediately replaces the active config for "${domainDef?.name ?? domain}" for all users.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowPublish(false)}
              disabled={publishMutation.loading}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              loading={publishMutation.loading}
              disabled={confirmPhrase !== 'publish to production' || !reason.trim()}
              onClick={() => { publishMutation.mutate(undefined).catch(() => undefined); }}
            >
              Publish
            </Button>
          </>
        }
      >
        {/* Diff summary inside dialog */}
        {diff.length > 0 && (
          <div style={{ marginBottom: '1.25rem' }}>
            <p className="section-label" style={{ marginBottom: '0.5rem' }}>What changes</p>
            <div className="diff-wrap" style={{ maxHeight: '180px' }}>
              {diff.map(({ key, label, old: oldVal, new: newVal }) => {
                const field = domainDef?.fields.find((f) => f.key === key);
                return (
                  <div key={key} className="diff-row">
                    <p className="diff-row-label">{label}</p>
                    <p className="diff-old">
                      {field ? formatDisplayValue(field, oldVal) : JSON.stringify(oldVal)}
                    </p>
                    <p className="diff-new">
                      {field ? formatDisplayValue(field, newVal) : JSON.stringify(newVal)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label className="field-label" htmlFor="publish-reason">Reason for this change</label>
          <Input
            id="publish-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Increase chat rate per Q3 pricing review"
            disabled={publishMutation.loading}
          />
        </div>

        <div className="field" style={{ marginBottom: '0.5rem' }}>
          <label className="field-label" htmlFor="confirm-phrase">
            Type <strong>publish to production</strong> to confirm
          </label>
          <Input
            id="confirm-phrase"
            value={confirmPhrase}
            onChange={(e) => {
              setConfirmPhrase(e.target.value);
              setPublishError(null);
            }}
            placeholder="publish to production"
            error={confirmPhrase !== '' && confirmPhrase !== 'publish to production'}
            disabled={publishMutation.loading}
            autoComplete="off"
          />
        </div>

        {publishError && (
          <p className="alert alert--error" style={{ marginTop: '0.75rem' }}>{publishError}</p>
        )}
      </Dialog>
    </div>
  );
}

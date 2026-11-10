'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDomain, validatePayload } from '@/lib/config-registry';
import { buildConfigDiff } from '@/lib/config-view';
import { ConfigEditorView, PUBLISH_PHRASE } from '@/components/config/ConfigEditorView';
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

/** State, validation and the draft/publish API calls. All presentation is in ConfigEditorView. */
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
      if (confirmPhrase !== PUBLISH_PHRASE) throw new Error('Type the exact phrase to confirm.');
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

  const diff = savedDraftId != null ? buildConfigDiff(activePayload, payload, domainDef) : [];

  function closePublish() {
    setShowPublish(false);
    setConfirmPhrase('');
    setReason('');
    setPublishError(null);
    publishMutation.reset();
  }

  return (
    <ConfigEditorView
      domainName={domainDef?.name ?? domain}
      domainDef={domainDef ?? null}
      payload={payload}
      onPayloadChange={handlePayloadChange}
      jsonText={jsonText}
      jsonError={jsonError}
      onJsonChange={handleJsonChange}
      validationErrors={validationErrors}
      showAdvanced={showAdvanced}
      onToggleAdvanced={() => setShowAdvanced((v) => !v)}
      diff={diff}
      isDirty={isDirty}
      hasSavedDraft={savedDraftId != null}
      saving={saveMutation.loading}
      saveError={saveMutation.error}
      onSave={() => {
        saveMutation.mutate(undefined).catch(() => undefined);
      }}
      onDiscard={() => {
        setPayload(seedPayload);
        setJsonText(JSON.stringify(seedPayload, null, 2));
        setJsonError(null);
        setIsDirty(false);
        setSavedDraftId(draftVersion?.id ?? null);
        saveMutation.reset();
      }}
      onOpenPublish={() => setShowPublish(true)}
      publish={{
        open: showPublish,
        reason,
        confirmPhrase,
        error: publishError,
        pending: publishMutation.loading,
        onReasonChange: setReason,
        onPhraseChange: (v) => {
          setConfirmPhrase(v);
          setPublishError(null);
        },
        onClose: closePublish,
        onConfirm: () => {
          publishMutation.mutate(undefined).catch(() => undefined);
        },
      }}
    />
  );
}

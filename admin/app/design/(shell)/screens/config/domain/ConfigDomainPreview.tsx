'use client';

import * as React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/ui/badge';
import { ConfigEditorView, PUBLISH_PHRASE } from '@/components/config/ConfigEditorView';
import { ConfigDomainSkeleton } from '@/components/config/ConfigSkeletons';
import { VersionHistory } from '@/components/config/VersionHistory';
import { getDomain, validatePayload } from '@/lib/config-registry';
import { buildConfigDiff } from '@/lib/config-view';
import { HISTORY, PAYLOADS } from '../fixtures';

/** Real ConfigEditorView + real validatePayload, with fixture data and no network. */
export function ConfigDomainPreview({ domain, state }: { domain: string; state: string }) {
  const def = getDomain(domain) ?? null;
  const live = React.useMemo(() => PAYLOADS[domain] ?? { foo: 1, bar: ['a', 'b'] }, [domain]);

  const initial = React.useMemo(() => {
    const p = { ...live };
    if (def && domain === 'economics') {
      if (state === 'saved' || state === 'publish') {
        p.chat_rate_tokens_per_min = 25;
        p.video_rate_tokens_per_min = 40;
        p.provider_share_percent = 62;
      }
      if (state === 'dirty') p.chat_rate_tokens_per_min = 25;
      if (state === 'invalid') p.chat_rate_tokens_per_min = 900;
    }
    return p;
  }, [live, def, domain, state]);

  const [payload, setPayload] = React.useState<Record<string, unknown>>(initial);
  const [dirty, setDirty] = React.useState(state === 'dirty' || state === 'invalid' || state === 'error');
  const [saved, setSaved] = React.useState(state === 'saved' || state === 'publish');
  const [advanced, setAdvanced] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(state === 'error' ? 'HTTP 409: a newer draft exists for this domain.' : null);
  const [jsonText, setJsonText] = React.useState(() => JSON.stringify(initial, null, 2));
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [pub, setPub] = React.useState({ open: state === 'publish', reason: '', phrase: '' });

  if (state === 'loading') return <ConfigDomainSkeleton />;

  const errors = def ? validatePayload(def, payload) : [];
  const diff = saved ? buildConfigDiff(live, payload, def ?? undefined) : [];
  const name = def?.name ?? domain;

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title={name}
        description={def?.description ?? 'Not in the registry: raw JSON only.'}
        breadcrumbs={[{ label: 'App config', href: '/design/screens/config' }, { label: name }]}
        actions={
          <>
            {saved && <StatusBadge status="draft">Draft v13</StatusBadge>}
            <StatusBadge status="active">Live v12</StatusBadge>
          </>
        }
      />
      <ConfigEditorView
        domainName={name}
        domainDef={def}
        payload={payload}
        onPayloadChange={(n) => {
          setPayload(n);
          setJsonText(JSON.stringify(n, null, 2));
          setDirty(true);
          setSaved(false);
          setSaveError(null);
        }}
        jsonText={jsonText}
        jsonError={jsonError}
        onJsonChange={(v) => {
          setJsonText(v);
          setDirty(true);
          setSaved(false);
          try {
            setPayload(JSON.parse(v) as Record<string, unknown>);
            setJsonError(null);
          } catch {
            setJsonError('Invalid JSON — fix before saving.');
          }
        }}
        validationErrors={errors}
        showAdvanced={advanced}
        onToggleAdvanced={() => setAdvanced((v) => !v)}
        diff={diff}
        isDirty={dirty}
        hasSavedDraft={saved}
        saving={saving}
        saveError={saveError}
        onSave={() => {
          setSaving(true);
          setTimeout(() => {
            setSaving(false);
            setSaved(true);
            setDirty(false);
          }, 700);
        }}
        onDiscard={() => {
          setPayload(live);
          setJsonText(JSON.stringify(live, null, 2));
          setDirty(false);
          setSaved(false);
          setSaveError(null);
        }}
        onOpenPublish={() => setPub((s) => ({ ...s, open: true }))}
        publish={{
          open: pub.open,
          reason: pub.reason,
          confirmPhrase: pub.phrase,
          error: state === 'publish' && pub.phrase === PUBLISH_PHRASE ? 'HTTP 403: reason rejected by policy.' : null,
          pending: false,
          onReasonChange: (v) => setPub((s) => ({ ...s, reason: v })),
          onPhraseChange: (v) => setPub((s) => ({ ...s, phrase: v })),
          onClose: () => setPub({ open: false, reason: '', phrase: '' }),
          onConfirm: () => setPub({ open: false, reason: '', phrase: '' }),
        }}
      />
      <VersionHistory items={state === 'empty-history' ? [] : HISTORY} />
    </div>
  );
}

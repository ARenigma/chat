'use client';

import { useState } from 'react';

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

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, { bg: string; text: string }> = {
    active: { bg: '#dcfce7', text: '#166534' },
    draft: { bg: '#fef9c3', text: '#854d0e' },
    superseded: { bg: '#f1f5f9', text: '#64748b' },
    scheduled: { bg: '#dbeafe', text: '#1e40af' },
  };
  const c = colours[status] ?? { bg: '#f1f5f9', text: '#64748b' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.125rem 0.5rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: c.bg,
        color: c.text,
      }}
    >
      {status}
    </span>
  );
}

export function ConfigVersionEditor({ domain, activeVersion, draftVersion }: Props) {
  const seedPayload = draftVersion?.payload ?? activeVersion?.payload ?? {};
  const [draft, setDraft] = useState(() => JSON.stringify(seedPayload, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftVersion?.id ?? null);

  // Publish confirmation state.
  const [showPublish, setShowPublish] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  function handleDraftChange(v: string) {
    setDraft(v);
    try {
      JSON.parse(v);
      setParseError(null);
    } catch {
      setParseError('Invalid JSON');
    }
  }

  async function saveDraft() {
    setSaving(true);
    setSaveError(null);
    try {
      JSON.parse(draft); // validate before send
    } catch {
      setSaveError('Fix JSON errors before saving.');
      setSaving(false);
      return;
    }

    const res = await fetch(`/api/config/${domain}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: JSON.parse(draft) }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveError(body.error ?? `HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as { id?: string };
      setSavedDraftId(body.id ?? null);
    }
    setSaving(false);
  }

  async function publish() {
    if (confirmPhrase !== 'publish to production') {
      setPublishError('Type the exact phrase to confirm.');
      return;
    }
    if (!reason.trim()) {
      setPublishError('Reason is required.');
      return;
    }
    setPublishing(true);
    setPublishError(null);

    const res = await fetch(`/api/config/${domain}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_version_id: savedDraftId,
        confirmation_phrase: confirmPhrase,
        reason: reason.trim(),
        reauth_timestamp: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setPublishError(body.error ?? `HTTP ${res.status}`);
      setPublishing(false);
      return;
    }
    // Reload to reflect the newly active version.
    window.location.reload();
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '0.375rem',
    display: 'block',
  };

  return (
    <div>
      {/* Active version read-only view */}
      {activeVersion != null && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Active version</h2>
            <StatusBadge status="active" />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              v{activeVersion.version_number}
              {activeVersion.published_at != null && (
                <> · published {new Date(activeVersion.published_at).toLocaleString('en-IN')}</>
              )}
            </span>
          </div>
          <pre
            style={{
              background: 'var(--bg-sunken)',
              borderRadius: '10px',
              padding: '1rem',
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-mono)',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: '280px',
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(activeVersion.payload, null, 2)}
          </pre>
        </section>
      )}

      {/* Draft editor */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Draft editor</h2>
          {savedDraftId != null && <StatusBadge status="draft" />}
        </div>

        <label htmlFor="payload-editor" style={labelStyle}>
          Edit payload (JSON)
        </label>
        <textarea
          id="payload-editor"
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          spellCheck={false}
          rows={16}
          style={{
            width: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            padding: '0.875rem',
            border: `1px solid ${parseError != null ? 'var(--bg-accent)' : 'var(--border-hairline)'}`,
            borderRadius: '10px',
            background: 'var(--bg-sunken)',
            resize: 'vertical',
            color: 'var(--text-primary)',
          }}
        />
        {parseError != null && (
          <p style={{ color: 'var(--bg-accent-strong)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
            {parseError}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => {
              saveDraft().catch(() => undefined);
            }}
            disabled={saving || parseError != null}
            style={{
              padding: '0.5rem 1.125rem',
              background: 'var(--bg-inverse)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: saving || parseError != null ? 'not-allowed' : 'pointer',
              opacity: saving || parseError != null ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>

          <button
            onClick={() => setShowPublish(true)}
            disabled={savedDraftId == null}
            style={{
              padding: '0.5rem 1.125rem',
              background: savedDraftId != null ? 'var(--bg-accent-strong)' : 'var(--bg-sunken)',
              color: savedDraftId != null ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: savedDraftId == null ? 'not-allowed' : 'pointer',
            }}
          >
            Publish to production…
          </button>

          {saveError != null && (
            <p style={{ color: 'var(--bg-accent-strong)', fontSize: '0.8125rem' }}>{saveError}</p>
          )}
        </div>
      </section>

      {/* Publish confirmation */}
      {showPublish && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--bg-raised)',
              borderRadius: '16px',
              padding: '2rem',
              width: '480px',
              maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Publish to production
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              This immediately replaces the active prod config for{' '}
              <strong>{domain}</strong>.
            </p>

            <label style={labelStyle} htmlFor="publish-reason">
              Reason for this change
            </label>
            <input
              id="publish-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Increase chat rate to 25 tokens/min per ADR-0020 update"
              style={{
                width: '100%',
                padding: '0.625rem 0.75rem',
                border: '1px solid var(--border-hairline)',
                borderRadius: '8px',
                fontSize: '0.875rem',
                marginBottom: '1rem',
                background: 'var(--bg-sunken)',
                color: 'var(--text-primary)',
              }}
            />

            <label style={labelStyle} htmlFor="confirm-phrase">
              Type <strong>publish to production</strong> to confirm
            </label>
            <input
              id="confirm-phrase"
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder="publish to production"
              style={{
                width: '100%',
                padding: '0.625rem 0.75rem',
                border: `1px solid ${confirmPhrase !== '' && confirmPhrase !== 'publish to production' ? 'var(--bg-accent)' : 'var(--border-hairline)'}`,
                borderRadius: '8px',
                fontSize: '0.875rem',
                marginBottom: '1rem',
                background: 'var(--bg-sunken)',
                color: 'var(--text-primary)',
              }}
            />

            {publishError != null && (
              <p
                style={{
                  color: 'var(--bg-accent-strong)',
                  fontSize: '0.8125rem',
                  marginBottom: '1rem',
                }}
              >
                {publishError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowPublish(false);
                  setConfirmPhrase('');
                  setReason('');
                  setPublishError(null);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--bg-sunken)',
                  color: 'var(--text-primary)',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  publish().catch(() => undefined);
                }}
                disabled={publishing || confirmPhrase !== 'publish to production' || !reason.trim()}
                style={{
                  padding: '0.5rem 1.125rem',
                  background: 'var(--bg-accent-strong)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor:
                    publishing || confirmPhrase !== 'publish to production' || !reason.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    publishing || confirmPhrase !== 'publish to production' || !reason.trim()
                      ? 0.5
                      : 1,
                }}
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

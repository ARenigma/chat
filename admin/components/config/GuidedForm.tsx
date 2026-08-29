'use client';

import { type DomainDef, type FieldDef, toDisplayValue, toStoredValue } from '@/lib/config-registry';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { RuntimeBadge } from '@/components/ui/Badge';

interface GuidedFieldProps {
  field: FieldDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

function GuidedField({ field, value, onChange, disabled }: GuidedFieldProps) {
  function handleNumber(raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      onChange(field.key, field.type === 'percent' ? toStoredValue(field.type, n) : n);
    }
  }

  switch (field.type) {
    case 'boolean':
      return (
        <Switch
          checked={Boolean(value)}
          onChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        />
      );

    case 'enum':
      return (
        <select
          className="input"
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
          style={{ appearance: 'auto', cursor: 'pointer' }}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'rupees':
    case 'paise':
    case 'integer':
    case 'days':
    case 'hours': {
      const displayVal =
        typeof value === 'number'
          ? String(toDisplayValue(field.type, value as number))
          : String(value ?? '');

      const prefix: string | undefined =
        field.type === 'rupees' || field.type === 'paise' ? '₹' : undefined;
      const suffix: string | undefined =
        field.type === 'days' ? 'days' : field.type === 'hours' ? 'hrs' : undefined;

      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          {prefix && (
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              {prefix}
            </span>
          )}
          <Input
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min}
            max={field.max}
            step={field.type === 'paise' ? 0.01 : 1}
            onChange={(e) => handleNumber(e.target.value)}
            style={{ maxWidth: '160px' }}
          />
          {suffix && (
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{suffix}</span>
          )}
        </div>
      );
    }

    case 'percent': {
      const displayVal =
        typeof value === 'number'
          ? String(toDisplayValue(field.type, value as number))
          : String(value ?? '');
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Input
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min !== undefined ? field.min / 100 : undefined}
            max={field.max !== undefined ? field.max / 100 : undefined}
            step="0.01"
            onChange={(e) => handleNumber(e.target.value)}
            style={{ maxWidth: '160px' }}
          />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            %
          </span>
        </div>
      );
    }

    case 'rupee-array': {
      const arr = Array.isArray(value) ? (value as number[]) : [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {arr.map((v, i) => (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <span
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  ₹
                </span>
                <Input
                  type="number"
                  value={v}
                  min={1}
                  disabled={disabled}
                  style={{ width: '80px' }}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n > 0) {
                      const next = [...arr];
                      next[i] = n;
                      onChange(field.key, next);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={disabled}
                  aria-label="Remove"
                  className="btn btn--ghost btn--sm"
                  style={{ padding: '0.25rem 0.375rem' }}
                  onClick={() => {
                    const next = arr.filter((_, j) => j !== i);
                    onChange(field.key, next);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {!disabled && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => onChange(field.key, [...arr, 100])}
            >
              + Add pack
            </button>
          )}
        </div>
      );
    }

    case 'string-array': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {arr.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Input
                value={v}
                disabled={disabled}
                onChange={(e) => {
                  const next = [...arr];
                  next[i] = e.target.value;
                  onChange(field.key, next);
                }}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove"
                className="btn btn--ghost btn--sm"
                style={{ padding: '0.25rem 0.375rem', flexShrink: 0 }}
                onClick={() => {
                  onChange(field.key, arr.filter((_, j) => j !== i));
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {!disabled && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => onChange(field.key, [...arr, ''])}
            >
              + Add item
            </button>
          )}
        </div>
      );
    }

    case 'string':
      return (
        <Input
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );

    default:
      return null;
  }
}

interface GuidedFormProps {
  domain: DomainDef;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function GuidedForm({ domain, payload, onChange, disabled }: GuidedFormProps) {
  function handleFieldChange(key: string, value: unknown) {
    onChange({ ...payload, [key]: value });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {domain.fields.map((field) => (
        <div key={field.key} className="field">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <label className="field-label" htmlFor={`field-${field.key}`}>
              {field.label}
            </label>
            <RuntimeBadge status={field.runtime} />
            {field.risk === 'high' && (
              <span
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  background: 'var(--status-error-bg)',
                  color: 'var(--status-error-text)',
                  padding: '0.1rem 0.35rem',
                  borderRadius: 'var(--r-full)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                High impact
              </span>
            )}
          </div>
          <p className="field-description">{field.description}</p>
          {field.impact && (
            <p
              style={{
                fontSize: '0.75rem',
                color: field.risk === 'high' ? 'var(--text-accent)' : 'var(--text-secondary)',
                fontStyle: 'italic',
                marginBottom: '0.25rem',
              }}
            >
              {field.impact}
            </p>
          )}
          <div id={`field-${field.key}`} style={{ marginTop: '0.375rem' }}>
            <GuidedField
              field={field}
              value={payload[field.key]}
              onChange={handleFieldChange}
              disabled={disabled}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

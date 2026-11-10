'use client';

import { Plus, X } from '@phosphor-icons/react/dist/ssr';
import { type DomainDef, type FieldDef, toDisplayValue, toStoredValue } from '@/lib/config-registry';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { StatusBadge, type Tone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface GuidedFieldProps {
  field: FieldDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** Unit text beside a number input (currency prefix / unit suffix). */
function Unit({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-secondary">{children}</span>;
}

function GuidedField({ field, value, onChange, disabled, invalid, describedBy }: GuidedFieldProps) {
  const fieldId = `field-${field.key}`;

  function handleNumber(raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      onChange(field.key, field.type === 'percent' ? toStoredValue(field.type, n) : n);
    }
  }

  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-2.5">
          <Switch
            id={fieldId}
            checked={value === true}
            onCheckedChange={(v) => onChange(field.key, v)}
            disabled={disabled}
            aria-describedby={describedBy}
          />
          <span className="w-14 text-sm text-body">{value === true ? 'Enabled' : 'Disabled'}</span>
        </div>
      );

    case 'enum':
      return (
        <Select
          value={String(value ?? '')}
          onValueChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        >
          <SelectTrigger id={fieldId} className="w-48" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <div className="flex items-center gap-2">
          {prefix && <Unit>{prefix}</Unit>}
          <Input
            id={fieldId}
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min}
            max={field.max}
            step={field.type === 'paise' ? 0.01 : 1}
            onChange={(e) => handleNumber(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-28 tabular-nums"
          />
          {suffix && <Unit>{suffix}</Unit>}
        </div>
      );
    }

    case 'percent': {
      const displayVal =
        typeof value === 'number'
          ? String(toDisplayValue(field.type, value as number))
          : String(value ?? '');
      return (
        <div className="flex items-center gap-2">
          <Input
            id={fieldId}
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min !== undefined ? field.min / 100 : undefined}
            max={field.max !== undefined ? field.max / 100 : undefined}
            step="0.01"
            onChange={(e) => handleNumber(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-28 tabular-nums"
          />
          <Unit>%</Unit>
        </div>
      );
    }

    case 'percent-int': {
      const displayVal = typeof value === 'number' ? String(value) : String(value ?? '');
      return (
        <div className="flex items-center gap-2">
          <Input
            id={fieldId}
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min}
            max={field.max}
            step="1"
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) onChange(field.key, n);
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-28 tabular-nums"
          />
          <Unit>%</Unit>
        </div>
      );
    }

    case 'rupee-array': {
      const arr = Array.isArray(value) ? (value as number[]) : [];
      return (
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            {arr.map((v, i) => (
              <div key={i} className="flex items-center gap-1">
                <Unit>₹</Unit>
                <Input
                  type="number"
                  value={v}
                  min={1}
                  disabled={disabled}
                  aria-label={`${field.label} ${i + 1}`}
                  aria-invalid={invalid || undefined}
                  className="w-20 tabular-nums"
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n > 0) {
                      const next = [...arr];
                      next[i] = n;
                      onChange(field.key, next);
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Remove ${field.label} ${i + 1}`}
                  onClick={() => onChange(field.key, arr.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          {!disabled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onChange(field.key, [...arr, 100])}
            >
              <Plus /> Add pack
            </Button>
          )}
        </div>
      );
    }

    case 'string-array': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1.5">
          {arr.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={v}
                disabled={disabled}
                aria-label={`${field.label} ${i + 1}`}
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  const next = [...arr];
                  next[i] = e.target.value;
                  onChange(field.key, next);
                }}
              />
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove ${field.label} ${i + 1}`}
                onClick={() => onChange(field.key, arr.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          {!disabled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => onChange(field.key, [...arr, ''])}
            >
              <Plus /> Add item
            </Button>
          )}
        </div>
      );
    }

    case 'string':
      return (
        <Input
          id={fieldId}
          value={String(value ?? '')}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );

    default:
      return null;
  }
}

const RUNTIME_HINT: Record<string, string> = {
  live: 'Read by the backend or app at runtime',
  partial: 'Read in some enforcement paths only',
  seeded: 'Stored only; the app still uses its built-in fallback',
};

const RISK_TONE: Record<'low' | 'medium' | 'high', Tone> = { low: 'neutral', medium: 'warning', high: 'danger' };

/** Small chips shown beside a field label: runtime wiring and (medium/high) change risk. */
export function FieldChips({ field }: { field: Pick<FieldDef, 'runtime' | 'risk'> }) {
  return (
    <>
      <span title={RUNTIME_HINT[field.runtime]}>
        <StatusBadge status={field.runtime} className="h-4 px-1.5 text-2xs" />
      </span>
      {(field.risk === 'high' || field.risk === 'medium') && (
        <StatusBadge status={field.risk} tone={RISK_TONE[field.risk]} className="h-4 px-1.5 text-2xs">
          {field.risk === 'high' ? 'High impact' : 'Medium impact'}
        </StatusBadge>
      )}
    </>
  );
}

interface GuidedFormProps {
  domain: DomainDef;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
  disabled?: boolean;
  /** validatePayload() output; messages that start with a field's quoted label render under that row. */
  errors?: string[];
}

/** Linear settings rows: label + description left, control right, hairline between rows. */
export function GuidedForm({ domain, payload, onChange, disabled, errors = [] }: GuidedFormProps) {
  function handleFieldChange(key: string, value: unknown) {
    onChange({ ...payload, [key]: value });
  }

  return (
    <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-raised">
      {domain.fields.map((field) => {
        const fieldId = `field-${field.key}`;
        const fieldErrors = errors.filter((e) => e.startsWith(`"${field.label}"`));
        const invalid = fieldErrors.length > 0;
        const describedBy = [`${fieldId}-desc`, invalid ? `${fieldId}-err` : null].filter(Boolean).join(' ');
        const isArray = field.type === 'rupee-array' || field.type === 'string-array';
        return (
          <div
            key={field.key}
            data-testid={`config-field-${field.key}`}
            className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)] sm:gap-8"
          >
            <div className="min-w-0 sm:max-w-[420px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Label
                  htmlFor={isArray ? undefined : fieldId}
                  className={cn('text-sm font-medium text-primary', disabled && 'opacity-60')}
                >
                  {field.label}
                </Label>
                <FieldChips field={field} />
              </div>
              <p id={`${fieldId}-desc`} className="mt-1 text-xs leading-[18px] text-secondary">
                {field.description}
              </p>
              {field.impact && (
                <p className="mt-1 text-xs leading-[18px] text-tertiary">{field.impact}</p>
              )}
              {invalid && (
                <p id={`${fieldId}-err`} role="alert" className="mt-1 text-xs text-danger">
                  {fieldErrors.join(' ')}
                </p>
              )}
            </div>
            <div className={cn('flex min-w-0 sm:justify-end', isArray ? 'sm:w-[300px]' : 'sm:min-w-[160px]', field.type === 'string' && 'sm:w-[300px]')}>
              <div className={cn(isArray || field.type === 'string' ? 'w-full' : '')}>
                <GuidedField
                  field={field}
                  value={payload[field.key]}
                  onChange={handleFieldChange}
                  disabled={disabled}
                  invalid={invalid}
                  describedBy={describedBy}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

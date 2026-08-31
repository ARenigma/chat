'use client';

import { type DomainDef, type FieldDef, toDisplayValue, toStoredValue } from '@/lib/config-registry';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RuntimeBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface GuidedFieldProps {
  field: FieldDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

function GuidedField({ field, value, onChange, disabled }: GuidedFieldProps) {
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
        <div className="flex items-center gap-3">
          <Switch
            id={fieldId}
            checked={value === true}
            onCheckedChange={(v) => onChange(field.key, v)}
            disabled={disabled}
            aria-describedby={`${fieldId}-desc`}
          />
          <Label htmlFor={fieldId} className="text-sm leading-tight cursor-pointer">
            {value === true ? 'Enabled' : 'Disabled'}
            {!disabled && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                (not live until published)
              </span>
            )}
          </Label>
        </div>
      );

    case 'enum':
      return (
        <Select
          value={String(value ?? '')}
          onValueChange={(v) => onChange(field.key, v)}
          disabled={disabled}
        >
          <SelectTrigger id={fieldId} className="max-w-xs">
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
        <div className="flex items-center gap-2 max-w-xs">
          {prefix && <span className="text-sm font-semibold text-muted-foreground">{prefix}</span>}
          <Input
            id={fieldId}
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min}
            max={field.max}
            step={field.type === 'paise' ? 0.01 : 1}
            onChange={(e) => handleNumber(e.target.value)}
            className="max-w-[160px]"
          />
          {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
        </div>
      );
    }

    case 'percent': {
      const displayVal =
        typeof value === 'number'
          ? String(toDisplayValue(field.type, value as number))
          : String(value ?? '');
      return (
        <div className="flex items-center gap-2 max-w-xs">
          <Input
            id={fieldId}
            type="number"
            value={displayVal}
            disabled={disabled}
            min={field.min !== undefined ? field.min / 100 : undefined}
            max={field.max !== undefined ? field.max / 100 : undefined}
            step="0.01"
            onChange={(e) => handleNumber(e.target.value)}
            className="max-w-[160px]"
          />
          <span className="text-sm font-semibold text-muted-foreground">%</span>
        </div>
      );
    }

    case 'percent-int': {
      const displayVal = typeof value === 'number' ? String(value) : String(value ?? '');
      return (
        <div className="flex items-center gap-2 max-w-xs">
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
            className="max-w-[160px]"
          />
          <span className="text-sm font-semibold text-muted-foreground">%</span>
        </div>
      );
    }

    case 'rupee-array': {
      const arr = Array.isArray(value) ? (value as number[]) : [];
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {arr.map((v, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-sm font-semibold text-muted-foreground">₹</span>
                <Input
                  type="number"
                  value={v}
                  min={1}
                  disabled={disabled}
                  className="w-20"
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
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label="Remove"
                  onClick={() => onChange(field.key, arr.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onChange(field.key, [...arr, 100])}
            >
              + Add pack
            </Button>
          )}
        </div>
      );
    }

    case 'string-array': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-2">
          {arr.map((v, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={v}
                disabled={disabled}
                onChange={(e) => {
                  const next = [...arr];
                  next[i] = e.target.value;
                  onChange(field.key, next);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label="Remove"
                className="shrink-0"
                onClick={() => onChange(field.key, arr.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onChange(field.key, [...arr, ''])}
            >
              + Add item
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
          onChange={(e) => onChange(field.key, e.target.value)}
          className="max-w-sm"
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
    <div className="flex flex-col gap-7">
      {domain.fields.map((field) => {
        const fieldId = `field-${field.key}`;
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Label
                htmlFor={field.type !== 'boolean' ? fieldId : undefined}
                className={cn('font-semibold text-sm', disabled && 'opacity-60')}
              >
                {field.label}
              </Label>
              <RuntimeBadge status={field.runtime} />
              {field.risk === 'high' && (
                <span className="text-[10px] font-bold bg-[var(--status-error-bg)] text-[var(--status-error-text)] px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  High impact
                </span>
              )}
            </div>
            <p id={`${fieldId}-desc`} className="text-xs text-muted-foreground leading-relaxed">
              {field.description}
            </p>
            {field.impact && (
              <p
                className={cn(
                  'text-xs italic',
                  field.risk === 'high' ? 'text-[var(--text-accent)]' : 'text-muted-foreground'
                )}
              >
                {field.impact}
              </p>
            )}
            <div className="mt-1">
              <GuidedField
                field={field}
                value={payload[field.key]}
                onChange={handleFieldChange}
                disabled={disabled}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

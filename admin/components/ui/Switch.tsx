'use client';

import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
}

export function Switch({ checked, onChange, disabled, label, description }: SwitchProps) {
  const id = useId();

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={[
          'switch-track',
          checked ? 'is-on' : '',
          disabled ? 'is-disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => !disabled && onChange(!checked)}
        type="button"
      >
        <span className="switch-thumb" />
      </button>
      {(label || description) && (
        <label htmlFor={id} style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
          {label && (
            <span className="field-label" style={{ display: 'block' }}>
              {label}
            </span>
          )}
          {description && (
            <span className="field-description" style={{ display: 'block', marginTop: '0.125rem' }}>
              {description}
            </span>
          )}
        </label>
      )}
    </div>
  );
}

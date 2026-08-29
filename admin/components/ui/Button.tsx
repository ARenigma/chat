'use client';

import { type ComponentPropsWithoutRef, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, children, className, ...rest },
  ref
) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      className={cls}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

/** A Button that fires an async action and shows a spinner while pending. */
interface AsyncButtonProps extends Omit<ButtonProps, 'onClick'> {
  action: () => Promise<unknown>;
  loadingLabel?: string;
}

export function AsyncButton({ action, loadingLabel, children, ...rest }: AsyncButtonProps) {
  return (
    <Button
      {...rest}
      onClick={() => {
        action().catch(() => undefined);
      }}
    >
      {rest.loading ? (loadingLabel ?? children) : children}
    </Button>
  );
}

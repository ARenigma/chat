'use client';

import { type ComponentPropsWithoutRef, forwardRef } from 'react';

interface InputProps extends ComponentPropsWithoutRef<'input'> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={['input', error ? 'is-error' : '', className ?? ''].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

interface TextareaProps extends ComponentPropsWithoutRef<'textarea'> {
  error?: boolean;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, mono, className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={[
        'input',
        mono ? 'input--mono' : '',
        error ? 'is-error' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
});

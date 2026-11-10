'use client';

import { GoogleLogo, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { motion } from 'motion/react';
import { AsyncButton } from '@/components/ui/button';
import { DotGridBackground } from '@/components/react-bits/DotGridBackground';

interface LoginViewProps {
  error?: string | null;
  pending?: boolean;
  onSignIn: () => void;
}

/** Presentational sign-in screen. Used by /login (real OAuth) and /design/login (fixture). */
export function LoginView({ error, pending, onSignIn }: LoginViewProps) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-shell p-6">
      <DotGridBackground className="absolute inset-0" />
      {/* A single entrance for a screen seen once per session; short and subtle. */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        className="relative flex w-full max-w-[360px] flex-col items-center gap-6 rounded-lg border border-hairline-strong bg-raised p-8 shadow-dialog"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            aria-hidden="true"
            className="inline-flex size-9 items-center justify-center rounded-md bg-accent text-base font-bold text-on-accent"
          >
            P
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-primary">Pappal Admin</h1>
            <p className="mt-1 text-sm text-secondary">Sign in with your Google account to continue.</p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex w-full items-start gap-2 rounded-md border border-danger-dot/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger"
          >
            <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <AsyncButton className="w-full" size="lg" pending={pending} onClick={onSignIn}>
          {!pending && <GoogleLogo size={16} weight="bold" aria-hidden="true" />}
          {pending ? 'Redirecting…' : 'Continue with Google'}
        </AsyncButton>

        <p className="text-center text-xs text-tertiary">Access is restricted to the founder allowlist.</p>
      </motion.div>
    </div>
  );
}

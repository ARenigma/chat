'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { motion } from 'motion/react';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { AsyncButton } from '@/components/ui/button';
import { useMutation } from '@/lib/hooks/useMutation';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your Google account is not on the founder allowlist.',
  oauth_error: 'Sign-in failed. Please try again.',
  auth_error: 'Authentication callback failed. Please try again.',
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorKey = searchParams.get('error');

  const signIn = useMutation(async () => {
    const supabase = createBrowserSupabase();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (oauthError) {
      router.replace('/login?error=oauth_error');
      throw oauthError;
    }
  });

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="bg-card border rounded-2xl p-10 w-full max-w-[360px] flex flex-col items-center gap-6 shadow-sm"
      >
        {/* Wordmark */}
        <div className="text-center flex flex-col items-center gap-4">
          <div className="inline-flex items-center gap-2 bg-[var(--bg-inverse)] rounded-xl px-4 py-2">
            <span className="font-extrabold text-base tracking-tight text-white">Pappal</span>
            <span className="text-[10px] font-bold bg-[rgba(242,84,61,0.28)] text-[#ff7c68] rounded px-1.5 py-0.5 tracking-widest uppercase">
              ADMIN
            </span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Founder control plane</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in with your Google account to continue.
            </p>
          </div>
        </div>

        {errorKey && ERROR_MESSAGES[errorKey] && (
          <div
            role="alert"
            className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 text-sm text-red-800"
          >
            <span aria-hidden="true" className="mt-0.5">✕</span>
            <span>{ERROR_MESSAGES[errorKey]}</span>
          </div>
        )}

        <AsyncButton
          className="w-full gap-2.5"
          size="lg"
          pending={signIn.loading}
          onClick={() => { signIn.mutate(undefined).catch(() => undefined); }}
        >
          {!signIn.loading && <GoogleIcon />}
          {signIn.loading ? 'Redirecting…' : 'Sign in with Google'}
        </AsyncButton>

        <p className="text-xs text-muted-foreground text-center">
          Access is restricted to the founder allowlist.
        </p>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

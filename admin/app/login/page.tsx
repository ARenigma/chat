'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { LoginView } from '@/components/auth/login-view';
import { useMutation } from '@/lib/hooks/useMutation';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your Google account is not on the founder allowlist.',
  oauth_error: 'Sign-in failed. Please try again.',
  auth_error: 'Authentication callback failed. Please try again.',
};

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
    <LoginView
      error={errorKey ? (ERROR_MESSAGES[errorKey] ?? null) : null}
      pending={signIn.loading}
      onSignIn={() => {
        signIn.mutate(undefined).catch(() => undefined);
      }}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

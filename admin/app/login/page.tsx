'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/browser';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const [loading, setLoading] = useState(false);

  async function handleGoogleSignIn() {
    setLoading(true);
    const supabase = createBrowserSupabase();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Prompt for account selection so re-auth flows work correctly.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (oauthError) {
      console.error('OAuth error:', oauthError.message);
      router.replace('/login?error=oauth_error');
      setLoading(false);
    }
  }

  const errorMessages: Record<string, string> = {
    unauthorized: 'Your Google account is not on the founder allowlist.',
    oauth_error: 'Sign-in failed. Please try again.',
    auth_error: 'Authentication callback failed. Please try again.',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1.5rem',
        padding: '2rem',
        background: 'var(--bg-base)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          Pappal Admin
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
          Founder control plane
        </p>
      </div>

      {error && errorMessages[error] != null && (
        <div
          role="alert"
          style={{
            background: '#fbe4de',
            border: '1px solid #f2543d',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            fontSize: '0.875rem',
            color: '#c2401f',
            maxWidth: '320px',
            textAlign: 'center',
          }}
        >
          {errorMessages[error]}
        </div>
      )}

      <button
        onClick={() => {
          handleGoogleSignIn().catch(() => undefined);
        }}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1.5rem',
          background: 'var(--bg-inverse)',
          color: '#ffffff',
          border: 'none',
          borderRadius: '10px',
          fontSize: '0.9375rem',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {loading ? 'Redirecting…' : 'Sign in with Google'}
      </button>
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

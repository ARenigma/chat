'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { motion } from 'motion/react';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/Button';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your Google account is not on the founder allowlist.',
  oauth_error: 'Sign-in failed. Please try again.',
  auth_error: 'Authentication callback failed. Please try again.',
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorKey = searchParams.get('error');
  const [loading, setLoading] = useState(false);

  async function handleGoogleSignIn() {
    setLoading(true);
    const supabase = createBrowserSupabase();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Prompt for account selection so re-auth flows work correctly
        // and admin_sessions reauth_at is recorded on each sign-in.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (oauthError) {
      router.replace('/login?error=oauth_error');
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-base)',
        padding: '2rem',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--r-xl)',
          padding: '2.5rem 2rem',
          width: '100%',
          maxWidth: '360px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Wordmark */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'var(--bg-inverse)',
              borderRadius: 'var(--r-lg)',
              padding: '0.5rem 1rem',
              marginBottom: '1rem',
            }}
          >
            <span
              style={{
                fontWeight: 800,
                fontSize: '1rem',
                letterSpacing: '-0.02em',
                color: '#fff',
              }}
            >
              Pappal
            </span>
            <span
              style={{
                fontSize: '0.625rem',
                background: 'rgba(242,84,61,0.28)',
                color: '#ff7c68',
                borderRadius: '4px',
                padding: '0.1rem 0.35rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              ADMIN
            </span>
          </div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            Founder control plane
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
              marginTop: '0.375rem',
            }}
          >
            Sign in with your Google account to continue.
          </p>
        </div>

        {errorKey && ERROR_MESSAGES[errorKey] && (
          <div
            role="alert"
            className="alert alert--error"
            style={{ width: '100%', borderRadius: 'var(--r-md)' }}
          >
            <span aria-hidden="true">✕</span>
            <span>{ERROR_MESSAGES[errorKey]}</span>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          loading={loading}
          style={{ width: '100%' }}
          onClick={() => {
            handleGoogleSignIn().catch(() => undefined);
          }}
        >
          {loading ? 'Redirecting…' : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
                />
              </svg>
              Sign in with Google
            </>
          )}
        </Button>

        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
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

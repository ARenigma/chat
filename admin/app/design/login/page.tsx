'use client';

import * as React from 'react';
import { LoginView } from '@/components/auth/login-view';

export default function DesignLoginPage() {
  const [pending, setPending] = React.useState(false);
  return (
    <LoginView
      error="Your Google account is not on the founder allowlist."
      pending={pending}
      onSignIn={() => {
        setPending(true);
        setTimeout(() => setPending(false), 1500);
      }}
    />
  );
}

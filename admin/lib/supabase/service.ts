import { createClient } from '@supabase/supabase-js';

// Server-only. Never import from client components.
// SUPABASE_SERVICE_ROLE_KEY bypasses RLS — only call from server routes,
// middleware, and server components. The key must never be prefixed NEXT_PUBLIC_.
// Reference: https://supabase.com/docs/guides/auth/server-side/nextjs
export const createServiceClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        // Service client is stateless: no session persistence, no auto-refresh.
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

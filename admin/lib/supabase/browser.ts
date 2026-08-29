'use client';

import { createBrowserClient } from '@supabase/ssr';

// Browser-only Supabase client for client components (login page).
// Uses public anon key only — never the service role key.
export const createBrowserSupabase = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

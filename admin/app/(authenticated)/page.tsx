import { redirect } from 'next/navigation';

// The landing page is the dashboard. The OAuth callback defaults `next` to '/',
// so this one redirect keeps post-login behaviour without touching the auth flow.
export default function Home() {
  redirect('/dashboard');
}

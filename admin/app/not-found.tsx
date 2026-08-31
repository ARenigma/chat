import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
      <p className="text-5xl font-extrabold tracking-tighter text-border">404</p>
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="text-sm text-muted-foreground">This page does not exist or has been moved.</p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link href="/">← Back to dashboard</Link>
      </Button>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { designPreviewEnabled } from '@/lib/design-preview';
import { ThemeFromQuery } from './ThemeFromQuery';

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  if (!designPreviewEnabled()) notFound();
  return (
    <>
      <ThemeFromQuery />
      {children}
    </>
  );
}

'use client';

import { useTheme } from 'next-themes';
import DotGrid from '@/components/react-bits/DotGrid';

/**
 * The one quiet background (login). Dots take the quaternary text tone and light up
 * in the accent near the cursor; remounts on theme change so the colours re-resolve.
 */
export function DotGridBackground({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className={className} aria-hidden="true">
      <DotGrid
        key={resolvedTheme}
        dotSize={3}
        gap={22}
        baseColor="var(--text-quaternary)"
        activeColor="var(--accent)"
        opacity={0.45}
        fade={1}
        proximity={110}
        shockStrength={2}
        swell={0.6}
        glow={0.3}
      />
    </div>
  );
}

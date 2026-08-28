import React, { type ReactNode, useEffect, useState } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Defers mounting children until the next animation frame.
 *
 * Use this to wrap heavy screen trees inside a sliding/fading Animated.View so
 * the container mounts and begins its transition immediately (instant visual
 * feedback) while the content mounts one frame later, giving the animation's
 * first tick a clean frame budget.
 */
export function AfterPaint({ children, fallback = null }: Props): React.ReactElement {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return ready ? <>{children}</> : <>{fallback}</>;
}

'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';

/* ─── Types ──────────────────────────────────────────────────────────── */
export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastAPI {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

/* ─── Context ────────────────────────────────────────────────────────── */
const ToastContext = createContext<ToastAPI>({
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
});

export function useToast() {
  return useContext(ToastContext);
}

/* ─── Icons ──────────────────────────────────────────────────────────── */
const ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

/* ─── Provider ───────────────────────────────────────────────────────── */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = `t${++counterRef.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, variant }]);
    setTimeout(() => dismiss(id), variant === 'error' ? 6000 : 4000);
  }, [dismiss]);

  const api: ToastAPI = {
    success: (m) => add(m, 'success'),
    error: (m) => add(m, 'error'),
    info: (m) => add(m, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <MotionConfig reducedMotion="user">
        <div className="toast-stack" aria-live="polite" aria-atomic="false">
          <AnimatePresence mode="popLayout">
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                className={`toast toast--${t.variant}`}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                layout
              >
                <span className="toast-icon" aria-hidden="true">
                  {ICONS[t.variant]}
                </span>
                <span className="toast-message">{t.message}</span>
                <button
                  className="toast-close"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                >
                  ✕
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </MotionConfig>
    </ToastContext.Provider>
  );
}

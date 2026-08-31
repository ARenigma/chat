'use client';

// Sonner-backed toast system.
// Components use the `useToast` hook to imperatively fire toasts.
// The Toaster is mounted in app/layout.tsx via providers.tsx.

export { Toaster } from '@/components/ui/sonner';
import { toast as sonnerToast } from 'sonner';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

function useToast() {
  return {
    success: (message: string, opts?: Omit<ToastOptions, 'type'>) =>
      sonnerToast.success(message, {
        description: opts?.description,
        duration: opts?.duration,
        action: opts?.action ? { label: opts.action.label, onClick: opts.action.onClick } : undefined,
      }),
    error: (message: string, opts?: Omit<ToastOptions, 'type'>) =>
      sonnerToast.error(message, {
        description: opts?.description,
        duration: opts?.duration,
        action: opts?.action ? { label: opts.action.label, onClick: opts.action.onClick } : undefined,
      }),
    info: (message: string, opts?: Omit<ToastOptions, 'type'>) =>
      sonnerToast(message, {
        description: opts?.description,
        duration: opts?.duration,
      }),
    toast: sonnerToast,
  };
}

export { useToast };

'use client';

import { useCallback, useRef, useState } from 'react';

type MutationStatus = 'idle' | 'loading' | 'success' | 'error';

interface MutationState<TData = unknown> {
  status: MutationStatus;
  data: TData | null;
  error: string | null;
}

interface UseMutationReturn<TArgs, TData> {
  status: MutationStatus;
  data: TData | null;
  error: string | null;
  loading: boolean;
  mutate: (args: TArgs) => Promise<TData | null>;
  reset: () => void;
}

export function useMutation<TArgs = void, TData = unknown>(
  fn: (args: TArgs) => Promise<TData>,
  options?: {
    onSuccess?: (data: TData) => void;
    onError?: (error: string) => void;
  }
): UseMutationReturn<TArgs, TData> {
  const [state, setState] = useState<MutationState<TData>>({
    status: 'idle',
    data: null,
    error: null,
  });

  // Keep stable reference to latest options without re-rendering
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback(
    async (args: TArgs): Promise<TData | null> => {
      setState({ status: 'loading', data: null, error: null });
      try {
        const data = await fn(args);
        setState({ status: 'success', data, error: null });
        optionsRef.current?.onSuccess?.(data);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', data: null, error: message });
        optionsRef.current?.onError?.(message);
        return null;
      }
    },
    [fn]
  );

  const reset = useCallback(() => {
    setState({ status: 'idle', data: null, error: null });
  }, []);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    loading: state.status === 'loading',
    mutate,
    reset,
  };
}

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { invalidate } from '../api/invalidate.ts';
import { MOVES_TIMER } from '../api/timerState.ts';
import { useToast } from './Toast.tsx';

interface ActionOptions<TVars, TResult> {
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** Usually one of the `stale` lists in api/keys.ts. */
  invalidate?: readonly QueryKey[];
  /** Set for writes that change what the running entry shows; timer actions wait for them. */
  movesTimer?: boolean;
  success?: string | ((result: TResult, vars: TVars) => string);
  onSuccess?: (result: TResult, vars: TVars) => void;
  /** Instead of a toast, such as next to the field that caused it. */
  onError?: (error: Error, vars: TVars) => void;
}

/** Refreshes the given queries, shows a success toast and reports errors, so callers only describe the action. */
export function useAction<TVars = void, TResult = unknown>(options: ActionOptions<TVars, TResult>) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    meta: options.movesTimer ? MOVES_TIMER : undefined,
    mutationFn: options.mutationFn,
    onSuccess: (result, vars) => {
      if (options.invalidate) void invalidate(qc, options.invalidate);
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.show(message);
      options.onSuccess?.(result, vars);
    },
    onError: (error, vars) => (options.onError ? options.onError(error, vars) : toast.error(error)),
  });
}

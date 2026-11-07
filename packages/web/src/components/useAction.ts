import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { invalidate } from '../api/invalidate.ts';
import { useToast } from './Toast.tsx';

export interface ActionOptions<TVars, TResult> {
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** Query keys to refresh after success, usually one of the `stale` lists in api/keys.ts. */
  invalidate?: readonly QueryKey[];
  /** Toast shown after success. */
  success?: string | ((result: TResult, vars: TVars) => string);
  onSuccess?: (result: TResult, vars: TVars) => void;
  /** Shows a server error somewhere else, such as next to the field that caused it, instead of a toast. */
  onError?: (error: Error, vars: TVars) => void;
}

/**
 * A user action that writes to the server: it refreshes the given queries, shows a success toast
 * and reports server errors through `toast.error` (or `onError`), so callers only describe what
 * the action does.
 */
export function useAction<TVars = void, TResult = unknown>(options: ActionOptions<TVars, TResult>) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation<TResult, Error, TVars>({
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

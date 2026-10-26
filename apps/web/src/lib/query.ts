import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500) {
      return failureCount < 2;
    }
    return false;
  }
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
});
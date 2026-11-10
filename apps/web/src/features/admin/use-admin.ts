import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api';
import {
  adminLogin,
  adminLogout,
  adminProfile,
  type AdminCredentials,
} from '../../lib/admin-api';

export const ADMIN_QUERY_KEY = ['admin', 'me'] as const;

export function isAdminUnauthenticated(error: unknown): boolean {
  return isApiError(error) && (error.code === 'UNAUTHENTICATED' || error.code === 'FORBIDDEN');
}

export function adminProfileQuery() {
  return {
    queryKey: ADMIN_QUERY_KEY,
    queryFn: () => adminProfile(),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  };
}

export function useAdminProfile() {
  return useQuery(adminProfileQuery());
}

export function useAdminLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminCredentials) => adminLogin(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(ADMIN_QUERY_KEY, profile);
    },
    retry: 0,
  });
}

export function useAdminLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => adminLogout(),
    onSettled: () => {
      queryClient.removeQueries({ queryKey: ['admin'] });
    },
    retry: 0,
  });
}

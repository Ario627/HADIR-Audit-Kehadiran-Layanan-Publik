import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api';
import {
  loginWithOtp,
  loginWithPassword,
  logoutPartner,
  profileQuery,
  requestOtp,
} from '../../lib/partner-api';

export type LoginRequest =
  | { method: 'otp'; email: string; code: string }
  | { method: 'password'; email: string; password: string };

export function isUnauthenticated(error: unknown): boolean {
  return isApiError(error) && error.code === 'UNAUTHENTICATED';
}

export function usePartnerProfile() {
  return useQuery(profileQuery());
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (email: string) => requestOtp(email),
    retry: 0,
  });
}

export function usePartnerLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: LoginRequest) =>
      request.method === 'otp'
        ? loginWithOtp(request.email, request.code)
        : loginWithPassword(request.email, request.password),
    onSuccess: (profile) => {
      queryClient.setQueryData(['partner', 'me'], profile);
      void queryClient.invalidateQueries({ queryKey: ['partner', 'inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['partner', 'analytics'] });
    },
    retry: 0,
  });
}

export function usePartnerLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logoutPartner(),
    onSettled: () => {
      queryClient.removeQueries({ queryKey: ['partner'] });
    },
    retry: 0,
  });
}
import type {
  AuthLoginResponse,
  AuthMeResponse,
  AuthSignupResponse,
} from '../../types/api';
import { apiRequest } from './client';

export function signup(email: string, password: string) {
  return apiRequest<AuthSignupResponse>('/auth/signup', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
}

export function login(email: string, password: string) {
  return apiRequest<AuthLoginResponse>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
}

export function logout() {
  return apiRequest<void>('/auth/logout', { method: 'POST' });
}

export function getMe() {
  return apiRequest<AuthMeResponse>('/auth/me');
}

export function requestPasswordReset(email: string) {
  return apiRequest<{ message: string }>('/auth/password-reset/request', {
    method: 'POST',
    auth: false,
    body: { email },
  });
}

export function confirmPasswordReset(token: string, password: string) {
  return apiRequest<{ message: string }>('/auth/password-reset/confirm', {
    method: 'POST',
    auth: false,
    body: { token, password },
  });
}

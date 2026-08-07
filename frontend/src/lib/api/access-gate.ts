import { apiRequest } from './client';

export type AccessGateStatus = {
  configured: boolean;
  unlocked: boolean;
};

export function getAccessGateStatus(signal?: AbortSignal) {
  return apiRequest<AccessGateStatus>('/access-gate/status', {
    method: 'GET',
    auth: false,
    signal,
  });
}

export function verifyAccessGate(attempt: string) {
  return apiRequest<void>('/access-gate/verify', {
    method: 'POST',
    auth: false,
    body: { attempt },
  });
}

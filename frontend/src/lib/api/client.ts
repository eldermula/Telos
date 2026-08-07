import { ApiError, type ApiErrorBody } from '../../types/api';
import { clearToken, getToken } from '../auth-storage';

const DEFAULT_API_BASE = 'http://localhost:3000/api/v1';

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const errBody = data as ApiErrorBody | null;
    const code = errBody?.error?.code ?? 'UNKNOWN_ERROR';
    const message = errBody?.error?.message ?? `Request failed (${response.status})`;
    const details = errBody?.error?.details;

    if (response.status === 401 && auth) {
      clearToken();
    }

    throw new ApiError(response.status, code, message, details);
  }

  return data as T;
}

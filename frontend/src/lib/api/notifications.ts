import { apiRequest } from './client';
import type {
  NotificationPreferences,
  NotificationPreferencesResponse,
} from './settings';

export type NotificationItem = {
  id: string;
  type: string;
  message: string;
  read_status: boolean;
  created_at: string;
};

export type NotificationsPage = {
  data: NotificationItem[];
  meta: { page: number; limit: number; total: number };
};

export function listNotifications(params?: {
  page?: number;
  limit?: number;
}): Promise<NotificationsPage> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest<NotificationsPage>(`/notifications${suffix}`);
}

export function markNotificationRead(
  id: string,
  read_status: boolean,
): Promise<NotificationItem> {
  return apiRequest<NotificationItem>(`/notifications/${id}`, {
    method: 'PATCH',
    body: { read_status },
  });
}

export function getNotificationPreferences(): Promise<NotificationPreferencesResponse> {
  return apiRequest<NotificationPreferencesResponse>('/notifications/preferences');
}

export function updateNotificationPreferences(
  preferences: Partial<NotificationPreferences>,
): Promise<NotificationPreferencesResponse> {
  return apiRequest<NotificationPreferencesResponse>('/notifications/preferences', {
    method: 'PATCH',
    body: { preferences },
  });
}

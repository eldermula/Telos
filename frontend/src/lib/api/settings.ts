import { apiRequest } from './client';
import type { User } from '../../types/api';

export type ProfileSettings = User & {
  created_at: string;
  updated_at: string;
};

export type NotificationPreferences = {
  bot_start: boolean;
  bot_stop: boolean;
  connection_error: boolean;
  trading_error: boolean;
  strategy_switch: boolean;
  live_trading_confirmed: boolean;
  real_order: boolean;
};

export type NotificationPreferencesResponse = {
  preferences: NotificationPreferences;
  updated_at: string;
};

export function getProfile(): Promise<ProfileSettings> {
  return apiRequest<ProfileSettings>('/settings/profile');
}

export function updateProfile(body: {
  email?: string;
  current_password?: string;
  new_password?: string;
}): Promise<ProfileSettings> {
  return apiRequest<ProfileSettings>('/settings/profile', {
    method: 'PATCH',
    body,
  });
}

export function getNotificationPreferences(): Promise<NotificationPreferencesResponse> {
  return apiRequest<NotificationPreferencesResponse>('/settings/notifications');
}

export function updateNotificationPreferences(
  preferences: Partial<NotificationPreferences>,
): Promise<NotificationPreferencesResponse> {
  return apiRequest<NotificationPreferencesResponse>('/settings/notifications', {
    method: 'PATCH',
    body: { preferences },
  });
}

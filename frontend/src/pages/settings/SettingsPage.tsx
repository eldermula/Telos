import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import {
  getNotificationPreferences,
  getProfile,
  updateNotificationPreferences,
  updateProfile,
  type NotificationPreferences,
  type ProfileSettings,
} from '../../lib/api/settings';
import { ApiError } from '../../types/api';

const PREFERENCE_LABELS: Record<keyof NotificationPreferences, string> = {
  bot_start: 'Bot started',
  bot_stop: 'Bot stopped',
  connection_error: 'Broker connection errors',
  trading_error: 'Trading errors',
  strategy_switch: 'Strategy switches',
  live_trading_confirmed: 'Live trading confirmed',
  real_order: 'Real order activity',
};

export function SettingsPage() {
  const { refreshMe } = useAuth();
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [prefsMessage, setPrefsMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [nextProfile, nextPrefs] = await Promise.all([
      getProfile(),
      getNotificationPreferences(),
    ]);
    setProfile(nextProfile);
    setEmail(nextProfile.email);
    setPreferences(nextPrefs.preferences);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load settings.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onSaveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    setError(null);
    setProfileMessage(null);
    try {
      const body: {
        email?: string;
        current_password?: string;
        new_password?: string;
      } = {};
      if (email.trim().toLowerCase() !== profile.email.toLowerCase()) {
        body.email = email.trim();
      }
      if (newPassword) {
        body.current_password = currentPassword;
        body.new_password = newPassword;
      }
      if (!body.email && !body.new_password) {
        setProfileMessage('No changes to save.');
        return;
      }
      const updated = await updateProfile(body);
      setProfile(updated);
      setEmail(updated.email);
      setCurrentPassword('');
      setNewPassword('');
      await refreshMe();
      setProfileMessage('Profile updated.');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not update profile.',
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function onTogglePreference(key: keyof NotificationPreferences) {
    if (!preferences) return;
    setSavingPrefs(true);
    setError(null);
    setPrefsMessage(null);
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    try {
      const result = await updateNotificationPreferences({ [key]: next[key] });
      setPreferences(result.preferences);
      setPrefsMessage('Notification preferences saved.');
    } catch (err) {
      setPreferences(preferences);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not update notification preferences.',
      );
    } finally {
      setSavingPrefs(false);
    }
  }

  if (loading) {
    return <p className="text-text-secondary">Loading settings…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="type-display-sm">Settings</h1>
        <p className="mt-1 text-text-secondary">
          Manage your account profile and notification preferences.
        </p>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}

      <GlassCard>
        <h2 className="type-heading mb-4">Profile</h2>
        <form className="flex max-w-lg flex-col gap-4" onSubmit={onSaveProfile}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            hint="Required only when setting a new password."
          />
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            hint="Leave blank to keep your current password."
          />
          {profileMessage ? (
            <p className="type-caption text-text-secondary">{profileMessage}</p>
          ) : null}
          <div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-2">Notification Preferences</h2>
        <p className="mb-4 text-text-secondary type-caption">
          Choose which system events create in-app notifications.
        </p>
        <ul className="flex flex-col gap-3">
          {preferences
            ? (Object.keys(PREFERENCE_LABELS) as Array<keyof NotificationPreferences>).map(
                (key) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-4 border-b border-border-subtle py-2 last:border-b-0"
                  >
                    <span>{PREFERENCE_LABELS[key]}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preferences[key]}
                      disabled={savingPrefs}
                      onClick={() => void onTogglePreference(key)}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-150 ${
                        preferences[key] ? 'bg-accent-gold' : 'bg-border-subtle'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-bg-canvas transition-transform duration-150 ${
                          preferences[key] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                      <span className="sr-only">{PREFERENCE_LABELS[key]}</span>
                    </button>
                  </li>
                ),
              )
            : null}
        </ul>
        {prefsMessage ? (
          <p className="mt-3 type-caption text-text-secondary">{prefsMessage}</p>
        ) : null}
      </GlassCard>

      <GlassCard>
        <h2 className="type-heading mb-2">Broker Connection</h2>
        <p className="mb-4 text-text-secondary">
          Link, update, or disconnect your broker account from the broker
          onboarding screen.
        </p>
        <Link to="/onboarding/broker">
          <Button variant="secondary">Manage broker connection</Button>
        </Link>
      </GlassCard>
    </div>
  );
}

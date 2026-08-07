import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { BrandLogo } from '../../components/ui/BrandLogo';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import { ApiError } from '../../types/api';
import * as authApi from '../../lib/api/auth';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Login failed. Check your credentials and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="type-caption text-danger">{error}</p> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-6 type-caption">
        No account?{' '}
        <Link className="text-accent-gold hover:text-accent-gold-hover" to="/signup">
          Create one
        </Link>
        {' · '}
        <Link
          className="text-accent-gold hover:text-accent-gold-hover"
          to="/password-reset"
        >
          Reset password
        </Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email.trim(), password);
      navigate('/onboarding/broker', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Sign up failed. Try a different email.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Create account">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Minimum 8 characters"
        />
        {error ? <p className="type-caption text-danger">{error}</p> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-6 type-caption">
        Already have an account?{' '}
        <Link className="text-accent-gold hover:text-accent-gold-hover" to="/login">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function PasswordResetPage() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'request' | 'confirm'>('request');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onRequest(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await authApi.requestPasswordReset(email.trim());
      setMessage(result.message);
      setMode('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await authApi.confirmPasswordReset(token.trim(), password);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Reset password">
      {mode === 'request' ? (
        <form className="flex flex-col gap-4" onSubmit={onRequest}>
          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error ? <p className="type-caption text-danger">{error}</p> : null}
          {message ? <p className="type-caption text-success">{message}</p> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onConfirm}>
          <Input
            label="Reset token"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            hint="Paste the token from the server log until SMTP is configured."
          />
          <Input
            label="New password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="type-caption text-danger">{error}</p> : null}
          {message ? <p className="type-caption text-success">{message}</p> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
      <p className="mt-6 type-caption">
        <Link className="text-accent-gold hover:text-accent-gold-hover" to="/login">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas px-4 py-10">
      <GlassCard className="w-full max-w-md">
        <BrandLogo variant="full" className="h-10 w-auto" />
        <h1 className="type-display-sm mt-6 text-text-primary">{title}</h1>
        <div className="mt-6">{children}</div>
      </GlassCard>
    </div>
  );
}

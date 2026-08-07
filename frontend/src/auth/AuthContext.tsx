import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '../lib/api/auth';
import { clearToken, getToken, setToken } from '../lib/auth-storage';
import { ApiError, type User } from '../types/api';

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const current = getToken();
    if (!current) {
      setUser(null);
      setTokenState(null);
      return;
    }
    try {
      const result = await authApi.getMe();
      setUser({
        id: result.id,
        email: result.email,
        role: result.role,
      });
      setTokenState(current);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        setUser(null);
        setTokenState(null);
        return;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshMe();
      } catch {
        if (!cancelled) {
          clearToken();
          setUser(null);
          setTokenState(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    await authApi.signup(email, password);
    const result = await authApi.login(email, password);
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Always clear local session even if network/blacklist fails.
    } finally {
      clearToken();
      setTokenState(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, signup, logout, refreshMe }),
    [user, token, loading, login, signup, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

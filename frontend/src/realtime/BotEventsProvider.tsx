import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { BotEventsClient, getWsBaseUrl, type BotEventMessage, type WsConnectionState } from '../lib/ws';
import { clearToken } from '../lib/auth-storage';

type BotEventsContextValue = {
  connectionState: WsConnectionState;
  lastEvent: BotEventMessage | null;
  subscribe: (listener: (message: BotEventMessage) => void) => () => void;
};

const BotEventsContext = createContext<BotEventsContextValue | null>(null);

export function BotEventsProvider({ children }: { children: ReactNode }) {
  const { token, logout } = useAuth();
  const clientRef = useRef<BotEventsClient | null>(null);
  const [connectionState, setConnectionState] = useState<WsConnectionState>('idle');
  const [lastEvent, setLastEvent] = useState<BotEventMessage | null>(null);

  if (!clientRef.current) {
    clientRef.current = new BotEventsClient(getWsBaseUrl());
  }

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    const offMessage = client.onMessage((message) => setLastEvent(message));
    const offState = client.onStateChange((state) => setConnectionState(state));

    return () => {
      offMessage();
      offState();
    };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    if (token) {
      client.connect(token);
    } else {
      client.disconnect();
    }

    return () => {
      client.disconnect();
    };
  }, [token]);

  useEffect(() => {
    if (connectionState === 'auth_error') {
      clearToken();
      void logout();
    }
  }, [connectionState, logout]);

  const value = useMemo<BotEventsContextValue>(
    () => ({
      connectionState,
      lastEvent,
      subscribe: (listener) => {
        const client = clientRef.current;
        if (!client) return () => {};
        return client.onMessage(listener);
      },
    }),
    [connectionState, lastEvent],
  );

  return <BotEventsContext.Provider value={value}>{children}</BotEventsContext.Provider>;
}

export function useBotEventsContext(): BotEventsContextValue {
  const ctx = useContext(BotEventsContext);
  if (!ctx) {
    throw new Error('useBotEventsContext must be used within BotEventsProvider');
  }
  return ctx;
}

export type BotEventName =
  | 'connection.ready'
  | 'connection.error'
  | 'bot.status_changed'
  | 'trade.opened'
  | 'trade.closed'
  | 'equity.updated'
  | 'strategy.switched';

export type BotEventMessage = {
  event: BotEventName;
  bot_instance_id?: string | null;
  payload?: Record<string, unknown>;
  timestamp?: string;
};

export type WsConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'auth_error';

type Listener = (message: BotEventMessage) => void;
type StateListener = (state: WsConnectionState) => void;

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * Low-level bot-events WebSocket client (06_API_Specification.md Section 11/15).
 * Auth via `?token=` query param, same JWT as REST — not a second auth scheme.
 * One instance is expected per app session (owned by BotEventsProvider).
 */
export class BotEventsClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private readonly wsBaseUrl: string;

  constructor(wsBaseUrl: string) {
    this.wsBaseUrl = wsBaseUrl;
  }

  connect(token: string): void {
    this.manuallyClosed = false;
    this.token = token;
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.open();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.token = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setState('idle');
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: WsConnectionState) {
    this.stateListeners.forEach((l) => l(state));
  }

  private open(): void {
    if (!this.token) return;
    this.setState('connecting');

    const url = `${this.wsBaseUrl}/ws?token=${encodeURIComponent(this.token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.setState('open');
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as BotEventMessage;
        this.listeners.forEach((l) => l(message));
      } catch {
        // Ignore malformed frames rather than tearing down the connection.
      }
    };

    socket.onclose = (event) => {
      this.socket = null;
      // Server closes with 4401 for missing/invalid/blacklisted tokens
      // (backend/src/ws/websocket-server.js closeWithError) — stop retrying
      // rather than hammering an auth failure that won't self-resolve.
      if (event.code === 4401) {
        this.manuallyClosed = true;
        this.setState('auth_error');
        return;
      }
      this.setState('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose fires next; reconnect decision lives there.
    };
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || !this.token) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.open();
    }, this.backoffMs);
  }
}

export function getWsBaseUrl(): string {
  return import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3000';
}

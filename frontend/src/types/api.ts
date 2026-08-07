export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type User = {
  id: string;
  email: string;
  role: 'user' | 'admin';
};

export type AuthLoginResponse = {
  token: string;
  user: User;
};

export type AuthSignupResponse = {
  user: User;
};

export type AuthMeResponse = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  created_at?: string;
};

export type ConnectionStatus = 'connected' | 'disconnected' | 'error';

export type BrokerAccountType = 'demo' | 'contest' | 'real';

export type BrokerConnection = {
  id: string;
  broker_name: 'mt5';
  connection_status: ConnectionStatus;
  account_type: BrokerAccountType;
  linked_at: string;
  last_validated_at: string | null;
};

export type BrokerCredentials = {
  login: string;
  password: string;
  server: string;
};

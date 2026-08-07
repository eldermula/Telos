import type { BrokerConnection, BrokerCredentials } from '../../types/api';
import { apiRequest } from './client';

export function listBrokerConnections() {
  return apiRequest<BrokerConnection[]>('/broker-connections');
}

export function getBrokerConnection(id: string) {
  return apiRequest<BrokerConnection>(`/broker-connections/${id}`);
}

export function createBrokerConnection(credentials: BrokerCredentials) {
  return apiRequest<BrokerConnection>('/broker-connections', {
    method: 'POST',
    body: {
      broker_name: 'mt5',
      credentials,
    },
  });
}

export function updateBrokerConnection(id: string, credentials: BrokerCredentials) {
  return apiRequest<BrokerConnection>(`/broker-connections/${id}`, {
    method: 'PATCH',
    body: { credentials },
  });
}

export function deleteBrokerConnection(id: string) {
  return apiRequest<void>(`/broker-connections/${id}`, { method: 'DELETE' });
}

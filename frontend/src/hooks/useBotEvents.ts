import { useEffect } from 'react';
import { useBotEventsContext } from '../realtime/BotEventsProvider';
import type { BotEventMessage } from '../lib/ws';

/**
 * Subscribes `handler` to bot-events for the lifetime of the component.
 * Does not own the socket — BotEventsProvider does, so Trading/Dashboard
 * can share a single connection.
 */
export function useBotEvents(handler: (message: BotEventMessage) => void): void {
  const { subscribe } = useBotEventsContext();

  useEffect(() => {
    return subscribe(handler);
  }, [subscribe, handler]);
}

export { useBotEventsContext } from '../realtime/BotEventsProvider';

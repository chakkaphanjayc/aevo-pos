import {
  formatStoreChannel,
  type RealtimeEnvelope,
  type RealtimeEventName,
  type RealtimePayloadMap
} from "./channel";

export interface StoreRoomBroadcaster {
  broadcast<E extends RealtimeEventName>(
    event: E,
    payload: RealtimePayloadMap[E]
  ): Promise<void>;
}

export function createStoreEventEnvelope<E extends RealtimeEventName>(
  storeId: string,
  event: E,
  payload: RealtimePayloadMap[E]
): RealtimeEnvelope<RealtimePayloadMap[E]> {
  return {
    event,
    storeId,
    payload,
    timestamp: Date.now()
  };
}

export interface StoreEventBroadcasterSender {
  send(message: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
}

export interface StoreChannelProvider {
  channel(name: string): StoreEventBroadcasterSender;
}

/**
 * Creates a broadcaster using a Supabase Realtime client or compatible channel provider.
 * Catches errors gracefully if broadcast fails so core order processing is never blocked.
 */
export function createStoreRoomBroadcaster(
  provider: StoreChannelProvider,
  storeId: string
): StoreRoomBroadcaster {
  const channelName = formatStoreChannel(storeId);
  const ch = provider.channel(channelName);

  return {
    async broadcast<E extends RealtimeEventName>(
      event: E,
      payload: RealtimePayloadMap[E]
    ): Promise<void> {
      try {
        const envelope = createStoreEventEnvelope(storeId, event, payload);
        await ch.send({
          type: "broadcast",
          event,
          payload: envelope
        });
      } catch (cause) {
        // Logging only; real-time broadcast failure should never abort database transactions
        console.warn(`[Realtime] Failed to broadcast ${event} to ${channelName}:`, cause);
      }
    }
  };
}

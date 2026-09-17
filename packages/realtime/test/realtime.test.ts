import { describe, expect, test } from "bun:test";
import {
  formatStoreChannel,
  parseStoreChannel,
  createStoreRoomBroadcaster,
  createStoreEventEnvelope
} from "../src";

describe("realtime package", () => {
  test("formats and parses store channels", () => {
    const channel = formatStoreChannel("store-123");
    expect(channel).toBe("store:store-123");
    expect(parseStoreChannel(channel)).toBe("store-123");
    expect(parseStoreChannel("invalid-channel")).toBeNull();
  });

  test("creates event envelopes with store metadata", () => {
    const envelope = createStoreEventEnvelope("store-123", "catalog.updated", {
      storeId: "store-123",
      timestamp: 1700000000
    });
    expect(envelope.event).toBe("catalog.updated");
    expect(envelope.storeId).toBe("store-123");
    expect(envelope.payload.timestamp).toBe(1700000000);
    expect(envelope.timestamp).toBeGreaterThan(0);
  });

  test("broadcasts events to channel provider", async () => {
    const sentMessages: unknown[] = [];
    const mockProvider = {
      channel(name: string) {
        expect(name).toBe("store:store-abc");
        return {
          async send(message: unknown) {
            sentMessages.push(message);
            return { error: null };
          }
        };
      }
    };

    const broadcaster = createStoreRoomBroadcaster(mockProvider, "store-abc");
    await broadcaster.broadcast("order.payment", {
      orderId: "order-1",
      paymentMethod: "CASH",
      amountMinor: 5000,
      occurredAt: new Date().toISOString()
    });

    expect(sentMessages.length).toBe(1);
    const sent = sentMessages[0] as { type: string; event: string; payload: { storeId: string } };
    expect(sent.type).toBe("broadcast");
    expect(sent.event).toBe("order.payment");
    expect(sent.payload.storeId).toBe("store-abc");
  });

  test("gracefully handles channel broadcast failures without throwing", async () => {
    const failingProvider = {
      channel() {
        return {
          async send() {
            throw new Error("WebSocket disconnected");
          }
        };
      }
    };

    const broadcaster = createStoreRoomBroadcaster(failingProvider, "store-fail");
    // Should not throw:
    await expect(
      broadcaster.broadcast("catalog.updated", {
        storeId: "store-fail",
        timestamp: Date.now()
      })
    ).resolves.toBeUndefined();
  });
});

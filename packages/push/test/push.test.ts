import { describe, expect, it } from "bun:test";
import {
  createOrderConfirmedNotification,
  createOrderReadyNotification,
  validateWebPushSubscription
} from "../src";

describe("push package", () => {
  it("validates valid web push subscriptions", () => {
    const valid = {
      endpoint: "https://fcm.googleapis.com/fcm/send/sample-token",
      keys: {
        p256dh: "BM6h...",
        auth: "t_4..."
      }
    };
    expect(validateWebPushSubscription(valid)).toBe(true);
  });

  it("rejects invalid web push subscriptions", () => {
    expect(validateWebPushSubscription(null)).toBe(false);
    expect(validateWebPushSubscription({})).toBe(false);
    expect(validateWebPushSubscription({ endpoint: "http://insecure.com" })).toBe(false);
    expect(validateWebPushSubscription({ endpoint: "https://valid.com", keys: {} })).toBe(false);
  });

  it("generates order ready notification with queue number", () => {
    const notif = createOrderReadyNotification("SO-20260917-00001", "Q-005");
    expect(notif.title).toContain("Q-005");
    expect(notif.body).toContain("SO-20260917-00001");
    expect(notif.tag).toBe("order-ready-SO-20260917-00001");
    expect(notif.data?.queueNumber).toBe("Q-005");
  });

  it("generates order confirmed notification", () => {
    const notif = createOrderConfirmedNotification("SO-20260917-00002");
    expect(notif.title).toContain("รับออเดอร์แล้ว");
    expect(notif.body).toContain("SO-20260917-00002");
  });
});

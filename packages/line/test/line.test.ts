import { describe, expect, it } from "bun:test";
import {
  buildOrderConfirmedFlexMessage,
  buildOrderReadyFlexMessage,
  verifyLineSignature
} from "../src";

describe("line package", () => {
  it("builds order ready flex message template with queue number", () => {
    const flex = buildOrderReadyFlexMessage({
      storeName: "Aevo Cafe",
      orderNumber: "SO-20260917-00001",
      queueNumber: "Q-001",
      totalFormatted: "฿150.00"
    }) as any;

    expect(flex.type).toBe("bubble");
    expect(flex.header.contents[0].text).toContain("พร้อมรับแล้ว");
    expect(flex.body.contents[0].contents[1].text).toBe("Q-001");
  });

  it("builds order confirmed flex message template", () => {
    const flex = buildOrderConfirmedFlexMessage({
      storeName: "Aevo Cafe",
      orderNumber: "SO-20260917-00002",
      queueNumber: "Q-002",
      itemCount: 3,
      totalFormatted: "฿320.00"
    }) as any;

    expect(flex.type).toBe("bubble");
    expect(flex.header.contents[0].text).toContain("ได้รับออเดอร์แล้ว");
  });

  it("verifies signature with matching HMAC-SHA256", async () => {
    const secret = "test-channel-secret";
    const body = JSON.stringify({ events: [] });

    // Compute expected signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const validSig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

    const isValid = await verifyLineSignature(body, validSig, secret);
    expect(isValid).toBe(true);

    const isInvalid = await verifyLineSignature(body, "invalid-sig", secret);
    expect(isInvalid).toBe(false);
  });
});

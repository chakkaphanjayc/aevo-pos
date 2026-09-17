import { describe, expect, it } from "bun:test";
import type { ReceiptSummary } from "@aevo/contracts";
import { formatReceiptThermalText } from "../src/receipts";

describe("receipts repository and thermal formatting", () => {
  const sampleReceipt: ReceiptSummary = {
    id: "rcp-1",
    organizationId: "org-1",
    storeId: "store-1",
    orderId: "order-1",
    receiptNumber: "RCP-20260917-0012",
    orderNumber: "0012",
    storeSnapshot: {
      name: "AEVO Specialty Cafe",
      code: "BKK-01"
    },
    itemsSnapshot: [
      {
        productName: "Caramel Macchiato",
        variantName: "Large",
        quantity: 2,
        unitPriceMinor: 12000,
        subtotalMinor: 24000,
        modifiers: [{ name: "Oat Milk", priceMinor: 2000 }]
      },
      {
        productName: "Butter Croissant",
        variantName: null,
        quantity: 1,
        unitPriceMinor: 8500,
        subtotalMinor: 8500
      }
    ],
    subtotalMinor: 32500,
    discountMinor: 2500,
    taxMinor: 2100,
    totalMinor: 30000,
    paymentsSummary: [
      {
        method: "CASH",
        amountMinor: 30000,
        paidAt: "2026-09-17T06:00:00.000Z"
      }
    ],
    cashReceivedMinor: 50000,
    changeMinor: 20000,
    cashierName: "Somchai",
    reprintCount: 0,
    isVoid: false,
    createdAt: "2026-09-17T06:00:00.000Z"
  };

  it("formats 80mm thermal receipt correctly", () => {
    const text = formatReceiptThermalText(sampleReceipt, 80);
    expect(text).toContain("AEVO Specialty Cafe");
    expect(text).toContain("RCP-20260917-0012");
    expect(text).toContain("Caramel Macchiato");
    expect(text).toContain("Oat Milk");
    expect(text).toContain("300.00");
    expect(text).toContain("500.00");
    expect(text).toContain("200.00");
    expect(text).toContain("Somchai");
  });

  it("formats 58mm thermal receipt with void notice", () => {
    const voidedReceipt: ReceiptSummary = {
      ...sampleReceipt,
      isVoid: true,
      voidReason: "Customer cancelled",
      reprintCount: 1
    };
    const text = formatReceiptThermalText(voidedReceipt, 58);
    expect(text).toContain("VOID");
    expect(text).toContain("Customer cancelled");
    expect(text).toContain("สำเนาพิมพ์ซ้ำ");
  });
});

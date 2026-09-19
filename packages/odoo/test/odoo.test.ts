import { describe, expect, it } from "bun:test";
import type { OrderSummary } from "@aevo/contracts";
import { mapOrderToOdooSaleOrder, processOutboxToOdoo } from "../src";

describe("odoo package", () => {
  const sampleOrder: OrderSummary = {
    id: "ord-1",
    organizationId: "org-1",
    storeId: "store-1",
    orderNumber: "SO-20260917-00001",
    channel: "POS",
    orderType: "POS",
    fulfillmentType: "DINE_IN",
    status: "COMPLETED",
    paymentStatus: "PAID",
    currency: "THB",
    subtotalMinor: 12000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 12000,
    items: [
      {
        id: "item-1",
        lineNumber: 1,
        productId: "p-1",
        sku: "LATTE-L",
        productName: "Caffe Latte",
        variantName: "Large",
        unitPriceMinor: 12000,
        quantity: 2,
        subtotalMinor: 24000,
        modifiers: [{ id: "m-1", modifierId: "mod-1", modifierGroupId: "mg-1", name: "Oat Milk", priceDeltaMinor: 2000, quantity: 1 }]
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const config = {
    baseUrl: "https://my-odoo.com",
    db: "odoo_db",
    username: "admin",
    apiKey: "odoo_secret_key",
    defaultPartnerId: 42
  };

  it("maps Aevo Order to Odoo Sale Order structure", () => {
    const saleOrder = mapOrderToOdooSaleOrder(sampleOrder, config);
    expect(saleOrder.partner_id).toBe(42);
    expect(saleOrder.client_order_ref).toBe("SO-20260917-00001");
    expect(saleOrder.order_line).toHaveLength(1);
    expect(saleOrder.order_line[0]![2].name).toContain("Caffe Latte - Large (Oat Milk)");
    expect(saleOrder.order_line[0]![2].price_unit).toBe(120);
    expect(saleOrder.order_line[0]![2].product_uom_qty).toBe(2);
  });

  it("processes outbox events with mock client successfully", async () => {
    const mockClient = {
      callKw: async () => 123 // return newly created sale.order id
    };

    const events = [
      {
        id: "ev-1",
        eventType: "order.completed",
        payload: { order: sampleOrder },
        retryCount: 0
      }
    ];

    const result = await processOutboxToOdoo(events, config, mockClient as any);
    expect(result.processedEventIds).toContain("ev-1");
    expect(result.failedEventIds).toHaveLength(0);
    expect(result.deadLetteredIds).toHaveLength(0);
  });

  it("dead-letters events that exceeded retry threshold", async () => {
    const errorClient = {
      callKw: async () => {
        throw new Error("Odoo down");
      }
    };

    const events = [
      {
        id: "ev-fail",
        eventType: "order.completed",
        payload: { order: sampleOrder },
        retryCount: 5
      }
    ];

    const result = await processOutboxToOdoo(events, config, errorClient as any);
    expect(result.deadLetteredIds).toContain("ev-fail");
    expect(result.failedEventIds).toHaveLength(0);
  });
});

import { describe, expect, it } from "bun:test";
import {
  addKioskItem,
  calculateKioskTotals,
  createEmptyKioskCart,
  formatBaht,
  removeKioskItem,
  updateKioskItemQuantity
} from "../src/lib/kiosk-store";

describe("kiosk-store", () => {
  it("creates empty cart with defaults", () => {
    const cart = createEmptyKioskCart("MAIN");
    expect(cart.storeCode).toBe("MAIN");
    expect(cart.fulfillmentType).toBe("DINE_IN");
    expect(cart.paymentMethod).toBe("PROMPTPAY");
    expect(cart.items).toHaveLength(0);
  });

  it("adds and collapses identical items", () => {
    let cart = createEmptyKioskCart("MAIN");
    cart = addKioskItem(cart, {
      productId: "p-1",
      productName: "Burger",
      unitPriceMinor: 15000,
      modifiers: [{ modifierId: "m-1", name: "Cheese", priceDeltaMinor: 2000 }],
      quantity: 1
    });

    // Add again identical
    cart = addKioskItem(cart, {
      productId: "p-1",
      productName: "Burger",
      unitPriceMinor: 15000,
      modifiers: [{ modifierId: "m-1", name: "Cheese", priceDeltaMinor: 2000 }],
      quantity: 2
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);
    expect(cart.items[0]!.modifierPriceMinor).toBe(2000);
  });

  it("calculates totals accurately", () => {
    let cart = createEmptyKioskCart("MAIN");
    cart = addKioskItem(cart, {
      productId: "p-1",
      productName: "Burger",
      unitPriceMinor: 10000,
      modifiers: [{ modifierId: "m-1", name: "Cheese", priceDeltaMinor: 1500 }],
      quantity: 2
    });

    const totals = calculateKioskTotals(cart);
    // (10000 + 1500) * 2 = 23000 minor units
    expect(totals.totalMinor).toBe(23000);
    expect(formatBaht(totals.totalMinor)).toBe("฿230.00");
  });

  it("updates quantity and removes item when quantity reaches 0", () => {
    let cart = createEmptyKioskCart("MAIN");
    cart = addKioskItem(cart, {
      productId: "p-1",
      productName: "Water",
      unitPriceMinor: 2000,
      modifiers: [],
      quantity: 1
    });

    const itemId = cart.items[0]!.id;
    cart = updateKioskItemQuantity(cart, itemId, 3);
    expect(cart.items[0]!.quantity).toBe(3);

    cart = updateKioskItemQuantity(cart, itemId, 0);
    expect(cart.items).toHaveLength(0);
  });

  it("removes item directly by ID", () => {
    let cart = createEmptyKioskCart("MAIN");
    cart = addKioskItem(cart, {
      productId: "p-1",
      productName: "Water",
      unitPriceMinor: 2000,
      modifiers: [],
      quantity: 1
    });
    const itemId = cart.items[0]!.id;
    cart = removeKioskItem(cart, itemId);
    expect(cart.items).toHaveLength(0);
  });
});

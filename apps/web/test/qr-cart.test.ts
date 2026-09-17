import { describe, expect, test } from "bun:test";
import {
  createEmptyQrCart,
  addQrItem,
  updateQrQuantity,
  removeQrItem,
  clearQrCart,
  calculateQrTotals,
  formatMoney,
  lineTotal
} from "../src/lib/qr-cart";

describe("qr-cart", () => {
  test("creates an empty cart with storeCode and tableNumber", () => {
    const cart = createEmptyQrCart("STORE01", "T-05");
    expect(cart.storeCode).toBe("STORE01");
    expect(cart.tableNumber).toBe("T-05");
    expect(cart.fulfillmentType).toBe("DINE_IN");
    expect(cart.items.length).toBe(0);
  });

  test("defaults to TAKEAWAY when no tableNumber provided", () => {
    const cart = createEmptyQrCart("STORE01");
    expect(cart.fulfillmentType).toBe("TAKEAWAY");
  });

  test("adds items and collapses identical items", () => {
    let cart = createEmptyQrCart("STORE01");
    cart = addQrItem(cart, {
      productId: "p1",
      productName: "Espresso",
      unitPriceMinor: 5000,
      quantity: 1,
      modifiers: []
    });
    expect(cart.items.length).toBe(1);
    expect(cart.items[0].quantity).toBe(1);

    cart = addQrItem(cart, {
      productId: "p1",
      productName: "Espresso",
      unitPriceMinor: 5000,
      quantity: 2,
      modifiers: []
    });
    expect(cart.items.length).toBe(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  test("calculates totals with modifiers and item quantities", () => {
    let cart = createEmptyQrCart("STORE01");
    cart = addQrItem(cart, {
      productId: "p1",
      productName: "Latte",
      unitPriceMinor: 6500,
      quantity: 2,
      modifiers: [{ modifierId: "m-oat", name: "Oat Milk", priceDeltaMinor: 1500 }]
    });

    const item = cart.items[0];
    expect(lineTotal(item)).toBe((6500 + 1500) * 2);

    const totals = calculateQrTotals(cart);
    expect(totals.totalMinor).toBe(16000);
  });

  test("updates quantity and removes item when quantity reaches 0", () => {
    let cart = createEmptyQrCart("STORE01");
    cart = addQrItem(cart, {
      productId: "p1",
      productName: "Tea",
      unitPriceMinor: 4000,
      quantity: 2,
      modifiers: []
    });

    const itemId = cart.items[0].id;
    cart = updateQrQuantity(cart, itemId, 1);
    expect(cart.items[0].quantity).toBe(1);

    cart = updateQrQuantity(cart, itemId, 0);
    expect(cart.items.length).toBe(0);
  });

  test("removes item by ID and clears cart", () => {
    let cart = createEmptyQrCart("STORE01");
    cart = addQrItem(cart, {
      productId: "p1",
      productName: "Croissant",
      unitPriceMinor: 8000,
      quantity: 1,
      modifiers: []
    });

    const itemId = cart.items[0].id;
    cart = removeQrItem(cart, itemId);
    expect(cart.items.length).toBe(0);

    cart = addQrItem(cart, {
      productId: "p2",
      productName: "Cookie",
      unitPriceMinor: 4500,
      quantity: 1,
      modifiers: []
    });
    cart = clearQrCart(cart);
    expect(cart.items.length).toBe(0);
  });

  test("formats currency in Thai Baht format", () => {
    expect(formatMoney(12500)).toContain("125.00");
  });
});

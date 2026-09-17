import { describe, expect, test } from "bun:test";
import type {
  ModifierGroupSummary,
  ProductModifierGroupMapping,
  ProductSummary
} from "@aevo/contracts";
import {
  addItem,
  buildProductModifierGroupMap,
  cartTotals,
  clearCart,
  createEmptyCart,
  formatMoney,
  getProductModifierGroups,
  isProductAvailable,
  lineTotal,
  removeItem,
  setCustomer,
  setFulfillmentType,
  updateQuantity
} from "../src/lib/pos-store";

describe("pos-store", () => {
  test("creates an empty cart with defaults", () => {
    const cart = createEmptyCart();
    expect(cart.items).toHaveLength(0);
    expect(cart.fulfillmentType).toBe("TAKEAWAY");
    expect(cart.customerName).toBe("");
  });

  test("adds item and calculates line total", () => {
    let cart = createEmptyCart();
    cart = addItem(cart, {
      id: "item-1",
      productId: "prod-1",
      productName: "Americano",
      unitPriceMinor: 6000,
      quantity: 2,
      modifiers: [{ modifierId: "mod-1", modifierGroupId: "grp-1", name: "Extra Shot", priceDeltaMinor: 1500 }],
      note: ""
    });

    expect(cart.items).toHaveLength(1);
    expect(lineTotal(cart.items[0])).toBe((6000 + 1500) * 2);

    const totals = cartTotals(cart);
    expect(totals.totalMinor).toBe(15000);
  });

  test("collapses identical items", () => {
    let cart = createEmptyCart();
    const item1 = {
      id: "item-1",
      productId: "prod-1",
      productName: "Latte",
      unitPriceMinor: 7000,
      quantity: 1,
      modifiers: [{ modifierId: "mod-oat", modifierGroupId: "grp-milk", name: "Oat Milk", priceDeltaMinor: 2000 }],
      note: "Less sweet"
    };
    const item2 = {
      id: "item-2",
      productId: "prod-1",
      productName: "Latte",
      unitPriceMinor: 7000,
      quantity: 2,
      modifiers: [{ modifierId: "mod-oat", modifierGroupId: "grp-milk", name: "Oat Milk", priceDeltaMinor: 2000 }],
      note: "Less sweet"
    };

    cart = addItem(cart, item1);
    cart = addItem(cart, item2);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  test("does not collapse items with different modifiers or notes", () => {
    let cart = createEmptyCart();
    cart = addItem(cart, {
      id: "item-1",
      productId: "prod-1",
      productName: "Latte",
      unitPriceMinor: 7000,
      quantity: 1,
      modifiers: [],
      note: ""
    });
    cart = addItem(cart, {
      id: "item-2",
      productId: "prod-1",
      productName: "Latte",
      unitPriceMinor: 7000,
      quantity: 1,
      modifiers: [{ modifierId: "mod-oat", modifierGroupId: "grp-milk", name: "Oat Milk", priceDeltaMinor: 2000 }],
      note: ""
    });

    expect(cart.items).toHaveLength(2);
  });

  test("updates quantity and removes when quantity is 0", () => {
    let cart = createEmptyCart();
    cart = addItem(cart, {
      id: "item-1",
      productId: "prod-1",
      productName: "Croissant",
      unitPriceMinor: 8500,
      quantity: 2,
      modifiers: [],
      note: ""
    });

    cart = updateQuantity(cart, "item-1", 5);
    expect(cart.items[0].quantity).toBe(5);

    cart = updateQuantity(cart, "item-1", 0);
    expect(cart.items).toHaveLength(0);
  });

  test("removes item by ID and clears cart", () => {
    let cart = createEmptyCart();
    cart = addItem(cart, { id: "item-1", productId: "p1", productName: "Tea", unitPriceMinor: 5000, quantity: 1, modifiers: [], note: "" });
    cart = addItem(cart, { id: "item-2", productId: "p2", productName: "Coffee", unitPriceMinor: 6000, quantity: 1, modifiers: [], note: "" });

    cart = removeItem(cart, "item-1");
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].id).toBe("item-2");

    cart = clearCart(cart);
    expect(cart.items).toHaveLength(0);
  });

  test("sets fulfillment type and customer info", () => {
    let cart = createEmptyCart();
    cart = setFulfillmentType(cart, "DINE_IN");
    expect(cart.fulfillmentType).toBe("DINE_IN");

    cart = setCustomer(cart, "Somchai", "0812345678");
    expect(cart.customerName).toBe("Somchai");
    expect(cart.customerPhone).toBe("0812345678");
  });

  test("builds product modifier group map and resolves groups", () => {
    const mappings: ProductModifierGroupMapping[] = [
      { productId: "prod-1", modifierGroupId: "grp-sweetness", sortOrder: 1 },
      { productId: "prod-1", modifierGroupId: "grp-milk", sortOrder: 0 },
      { productId: "prod-2", modifierGroupId: "grp-sweetness", sortOrder: 0 }
    ];

    const map = buildProductModifierGroupMap(mappings);
    expect(map.get("prod-1")).toEqual(["grp-milk", "grp-sweetness"]);
    expect(map.get("prod-2")).toEqual(["grp-sweetness"]);

    const allGroups: ModifierGroupSummary[] = [
      {
        id: "grp-milk",
        organizationId: "org-1",
        code: "MILK",
        name: "Milk",
        selectionType: "SINGLE",
        required: false,
        minSelections: 0,
        maxSelections: 1,
        status: "ACTIVE",
        modifiers: []
      },
      {
        id: "grp-sweetness",
        organizationId: "org-1",
        code: "SWEETNESS",
        name: "Sweetness",
        selectionType: "SINGLE",
        required: true,
        minSelections: 1,
        maxSelections: 1,
        status: "ACTIVE",
        modifiers: []
      },
      {
        id: "grp-archived",
        organizationId: "org-1",
        code: "ARCHIVED",
        name: "Archived",
        selectionType: "SINGLE",
        required: false,
        minSelections: 0,
        maxSelections: 1,
        status: "INACTIVE",
        modifiers: []
      }
    ];

    const groups = getProductModifierGroups("prod-1", map, allGroups);
    expect(groups.map((g) => g.id)).toEqual(["grp-milk", "grp-sweetness"]);
  });

  test("checks product availability for POS", () => {
    const activeAvailable: ProductSummary = {
      id: "p1",
      organizationId: "org-1",
      sku: "LATTE",
      name: "Latte",
      description: "Hot fresh latte",
      basePriceMinor: 7000,
      currency: "THB",
      status: "ACTIVE",
      variants: [],
      availability: [{ channel: "POS", isAvailable: true, soldOut: false }]
    };
    expect(isProductAvailable(activeAvailable, "POS")).toBe(true);

    const soldOutProduct: ProductSummary = {
      ...activeAvailable,
      availability: [{ channel: "POS", isAvailable: true, soldOut: true }]
    };
    expect(isProductAvailable(soldOutProduct, "POS")).toBe(false);

    const archivedProduct: ProductSummary = {
      ...activeAvailable,
      status: "ARCHIVED"
    };
    expect(isProductAvailable(archivedProduct, "POS")).toBe(false);
  });

  test("formats currency properly", () => {
    const formatted = formatMoney(12550);
    expect(formatted).toContain("125.50");
  });
});

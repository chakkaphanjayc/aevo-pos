/**
 * QR Self-Order Cart — pure client-side state for customer self-ordering.
 */

import { calculateOrderTotals, type PricingLineInput, type OrderTotals } from "@aevo/ordering";

export interface QrCartItemModifier {
  modifierId: string;
  name: string;
  priceDeltaMinor: number;
}

export interface QrCartItem {
  id: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  unitPriceMinor: number;
  modifierPriceMinor: number;
  modifiers: QrCartItemModifier[];
  quantity: number;
  note?: string;
}

export interface QrCart {
  items: QrCartItem[];
  storeCode: string;
  tableNumber?: string;
  fulfillmentType: "TAKEAWAY" | "DINE_IN";
  customerName?: string;
  customerPhone?: string;
  notes?: string;
}

export function createEmptyQrCart(storeCode: string, tableNumber?: string): QrCart {
  let savedName = "";
  let savedPhone = "";
  if (typeof localStorage !== "undefined") {
    try {
      savedName = localStorage.getItem("aevo.customerName") || "";
      savedPhone = localStorage.getItem("aevo.customerPhone") || "";
    } catch {
      // Ignore localStorage read errors
    }
  }

  return {
    items: [],
    storeCode,
    tableNumber,
    fulfillmentType: tableNumber ? "DINE_IN" : "TAKEAWAY",
    customerName: savedName,
    customerPhone: savedPhone
  };
}

export function saveCustomerInfo(name: string, phone: string): void {
  if (typeof localStorage !== "undefined") {
    try {
      if (name) localStorage.setItem("aevo.customerName", name);
      if (phone) localStorage.setItem("aevo.customerPhone", phone);
    } catch {
      // Ignore storage write errors
    }
  }
}

export function addQrItem(
  cart: QrCart,
  item: Omit<QrCartItem, "id" | "modifierPriceMinor">
): QrCart {
  const modifierPriceMinor = item.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);

  // Check if identical item already exists (same product, variant, modifiers, note)
  const modKey = (mods: QrCartItemModifier[]) =>
    mods.map((m) => m.modifierId).sort().join(",");
  const itemModKey = modKey(item.modifiers);

  const existingIdx = cart.items.findIndex(
    (existing) =>
      existing.productId === item.productId &&
      existing.variantId === item.variantId &&
      (existing.note || "") === (item.note || "") &&
      modKey(existing.modifiers) === itemModKey
  );

  if (existingIdx >= 0) {
    const updated = [...cart.items];
    const existing = updated[existingIdx];
    updated[existingIdx] = {
      ...existing,
      quantity: existing.quantity + item.quantity
    };
    return { ...cart, items: updated };
  }

  const newItem: QrCartItem = {
    ...item,
    id: crypto.randomUUID(),
    modifierPriceMinor
  };

  return { ...cart, items: [...cart.items, newItem] };
}

export function updateQrQuantity(cart: QrCart, itemId: string, quantity: number): QrCart {
  if (quantity <= 0) {
    return { ...cart, items: cart.items.filter((i) => i.id !== itemId) };
  }
  return {
    ...cart,
    items: cart.items.map((i) => (i.id === itemId ? { ...i, quantity } : i))
  };
}

export function removeQrItem(cart: QrCart, itemId: string): QrCart {
  return { ...cart, items: cart.items.filter((i) => i.id !== itemId) };
}

export function clearQrCart(cart: QrCart): QrCart {
  return { ...cart, items: [] };
}

export function lineTotal(item: QrCartItem): number {
  return (item.unitPriceMinor + item.modifierPriceMinor) * item.quantity;
}

export function calculateQrTotals(cart: QrCart): OrderTotals {
  const pricingLines: PricingLineInput[] = cart.items.map((item) => ({
    unitPriceMinor: item.unitPriceMinor,
    quantity: item.quantity,
    modifiers: item.modifiers.map((m) => ({
      priceDeltaMinor: m.priceDeltaMinor,
      quantity: 1
    }))
  }));

  return calculateOrderTotals(pricingLines);
}

export function formatMoney(amountMinor: number, currency = "THB"): string {
  const formatted = (amountMinor / 100).toFixed(2);
  if (currency === "THB") return `฿${formatted}`;
  return `${currency} ${formatted}`;
}

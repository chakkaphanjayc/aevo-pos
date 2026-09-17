/**
 * POS cart state management — pure client-side cart with quantity,
 * modifier tracking and total calculation using @aevo/ordering pricing.
 */

import type {
  FulfillmentType,
  ModifierGroupSummary,
  ProductModifierGroupMapping,
  ProductSummary,
  ProductVariantSummary
} from "@aevo/contracts";
import { calculateOrderTotals } from "@aevo/ordering";
import type { PricingLineInput, PricingModifierInput, OrderTotals } from "@aevo/ordering";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface CartItemModifier {
  modifierId: string;
  modifierGroupId: string;
  name: string;
  priceDeltaMinor: number;
}

export interface CartItem {
  /** Client-generated unique id for this cart line. */
  id: string;
  productId: string;
  variantId?: string;
  menuItemId?: string;
  productName: string;
  variantName?: string;
  modifiers: CartItemModifier[];
  /** Base unit price (variant price or product base price). */
  unitPriceMinor: number;
  quantity: number;
  note: string;
}

export interface Cart {
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  customerName: string;
  customerPhone: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createEmptyCart(): Cart {
  return {
    items: [],
    fulfillmentType: "TAKEAWAY",
    customerName: "",
    customerPhone: "",
    notes: ""
  };
}

/* ------------------------------------------------------------------ */
/*  Immutable cart operations                                         */
/* ------------------------------------------------------------------ */

export function addItem(cart: Cart, item: CartItem): Cart {
  // Collapse identical items (same product, variant, modifiers, note)
  const key = itemKey(item);
  const existing = cart.items.find((i) => itemKey(i) === key);
  if (existing) {
    return {
      ...cart,
      items: cart.items.map((i) =>
        i.id === existing.id ? { ...i, quantity: i.quantity + item.quantity } : i
      )
    };
  }
  return { ...cart, items: [...cart.items, item] };
}

export function removeItem(cart: Cart, itemId: string): Cart {
  return { ...cart, items: cart.items.filter((i) => i.id !== itemId) };
}

export function updateQuantity(cart: Cart, itemId: string, quantity: number): Cart {
  if (quantity <= 0) return removeItem(cart, itemId);
  return {
    ...cart,
    items: cart.items.map((i) => (i.id === itemId ? { ...i, quantity } : i))
  };
}

export function updateItemNote(cart: Cart, itemId: string, note: string): Cart {
  return {
    ...cart,
    items: cart.items.map((i) => (i.id === itemId ? { ...i, note } : i))
  };
}

export function clearCart(cart: Cart): Cart {
  return { ...cart, items: [] };
}

export function setFulfillmentType(cart: Cart, fulfillmentType: FulfillmentType): Cart {
  return { ...cart, fulfillmentType };
}

export function setCustomer(cart: Cart, name: string, phone: string): Cart {
  return { ...cart, customerName: name.trim(), customerPhone: phone.trim() };
}

/* ------------------------------------------------------------------ */
/*  Pricing                                                           */
/* ------------------------------------------------------------------ */

export function cartTotals(cart: Cart): OrderTotals {
  if (cart.items.length === 0) {
    return { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 };
  }
  const lines: PricingLineInput[] = cart.items.map((item) => ({
    unitPriceMinor: item.unitPriceMinor,
    quantity: item.quantity,
    modifiers: item.modifiers.map(
      (m): PricingModifierInput => ({ priceDeltaMinor: m.priceDeltaMinor, quantity: 1 })
    )
  }));
  return calculateOrderTotals(lines);
}

export function lineTotal(item: CartItem): number {
  const modTotal = item.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
  return (item.unitPriceMinor + modTotal) * item.quantity;
}

/* ------------------------------------------------------------------ */
/*  Catalog helpers                                                   */
/* ------------------------------------------------------------------ */

/** Build a lookup: productId → modifierGroupIds (sorted) */
export function buildProductModifierGroupMap(
  mappings: ProductModifierGroupMapping[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const sorted = [...mappings].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const m of sorted) {
    const list = map.get(m.productId) ?? [];
    list.push(m.modifierGroupId);
    map.set(m.productId, list);
  }
  return map;
}

/** Get the effective unit price for a product (prefers variant price). */
export function effectivePrice(
  product: ProductSummary,
  variant?: ProductVariantSummary
): number {
  return variant?.priceMinor ?? product.basePriceMinor;
}

/** Check if a product is available and not sold out for a given channel. */
export function isProductAvailable(product: ProductSummary, channel: string): boolean {
  if (product.status !== "ACTIVE") return false;
  const availability = product.availability.find((a) => a.channel === channel);
  if (!availability) return true; // No explicit rule = available
  return availability.isAvailable && !availability.soldOut;
}

/** Get modifier groups for a specific product. */
export function getProductModifierGroups(
  productId: string,
  productModifierGroupMap: Map<string, string[]>,
  allGroups: ModifierGroupSummary[]
): ModifierGroupSummary[] {
  const groupIds = productModifierGroupMap.get(productId) ?? [];
  return groupIds
    .map((id) => allGroups.find((g) => g.id === id))
    .filter((g): g is ModifierGroupSummary => g !== undefined && g.status === "ACTIVE");
}

/* ------------------------------------------------------------------ */
/*  Money formatting                                                  */
/* ------------------------------------------------------------------ */

const thbFormatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });

export function formatMoney(minor: number, currency = "THB"): string {
  if (currency === "THB") return thbFormatter.format(minor / 100);
  return new Intl.NumberFormat("th-TH", { style: "currency", currency }).format(minor / 100);
}

/* ------------------------------------------------------------------ */
/*  Private helpers                                                   */
/* ------------------------------------------------------------------ */

function itemKey(item: CartItem): string {
  const modKeys = item.modifiers.map((m) => m.modifierId).sort().join(",");
  return `${item.productId}:${item.variantId ?? ""}:${modKeys}:${item.note}`;
}

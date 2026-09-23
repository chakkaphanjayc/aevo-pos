import type {
  FulfillmentType,
  ModifierGroupSummary,
  ProductModifierGroupMapping,
  ProductSummary,
  ProductVariantSummary
} from "@aevo/contracts";
import { calculateOrderTotals, type OrderTotals } from "./pricing";

export interface CartItemModifier {
  modifierId: string;
  modifierGroupId: string;
  name: string;
  priceDeltaMinor: number;
}

export interface CartItem {
  id: string;
  productId: string;
  variantId?: string;
  menuItemId?: string;
  productName: string;
  variantName?: string;
  modifiers: CartItemModifier[];
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

export function createEmptyCart(): Cart {
  return { items: [], fulfillmentType: "TAKEAWAY", customerName: "", customerPhone: "", notes: "" };
}

export function addItem(cart: Cart, item: CartItem): Cart {
  const existing = cart.items.find((candidate) => itemKey(candidate) === itemKey(item));
  if (existing) return { ...cart, items: cart.items.map((candidate) => candidate.id === existing.id ? { ...candidate, quantity: candidate.quantity + item.quantity } : candidate) };
  return { ...cart, items: [...cart.items, item] };
}

export function removeItem(cart: Cart, itemId: string): Cart {
  return { ...cart, items: cart.items.filter((item) => item.id !== itemId) };
}

export function updateQuantity(cart: Cart, itemId: string, quantity: number): Cart {
  return quantity <= 0 ? removeItem(cart, itemId) : { ...cart, items: cart.items.map((item) => item.id === itemId ? { ...item, quantity } : item) };
}

export function clearCart(cart: Cart): Cart {
  return { ...cart, items: [] };
}

export function setFulfillmentType(cart: Cart, fulfillmentType: FulfillmentType): Cart {
  return { ...cart, fulfillmentType };
}

export function setCustomer(cart: Cart, customerName: string, customerPhone: string): Cart {
  return { ...cart, customerName: customerName.trim(), customerPhone: customerPhone.trim() };
}

export function cartTotals(cart: Cart): OrderTotals {
  return calculateOrderTotals(cart.items.map((item) => ({
    unitPriceMinor: item.unitPriceMinor,
    quantity: item.quantity,
    modifiers: item.modifiers.map((modifier) => ({ priceDeltaMinor: modifier.priceDeltaMinor, quantity: 1 }))
  })));
}

export function lineTotal(item: CartItem): number {
  return (item.unitPriceMinor + item.modifiers.reduce((sum, modifier) => sum + modifier.priceDeltaMinor, 0)) * item.quantity;
}

export function buildProductModifierGroupMap(mappings: ProductModifierGroupMapping[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const mapping of [...mappings].sort((left, right) => left.sortOrder - right.sortOrder)) {
    map.set(mapping.productId, [...(map.get(mapping.productId) ?? []), mapping.modifierGroupId]);
  }
  return map;
}

export function effectivePrice(product: ProductSummary, variant?: ProductVariantSummary): number {
  return variant?.priceMinor ?? product.basePriceMinor;
}

export function getProductModifierGroups(productId: string, mappings: Map<string, string[]>, groups: ModifierGroupSummary[]): ModifierGroupSummary[] {
  return (mappings.get(productId) ?? [])
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is ModifierGroupSummary => Boolean(group && group.status === "ACTIVE"));
}

export function formatMoney(minor: number, currency = "THB"): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency }).format(minor / 100);
}

function itemKey(item: CartItem): string {
  return `${item.productId}:${item.variantId ?? ""}:${item.modifiers.map((modifier) => modifier.modifierId).sort().join(",")}:${item.note}`;
}

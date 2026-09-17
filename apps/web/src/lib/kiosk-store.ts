/**
 * Kiosk Cart & Session Store — state machine and idle management for unattended kiosk.
 */

import { calculateOrderTotals, type PricingLineInput, type OrderTotals } from "@aevo/ordering";

export interface KioskCartItemModifier {
  modifierId: string;
  name: string;
  priceDeltaMinor: number;
}

export interface KioskCartItem {
  id: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  unitPriceMinor: number;
  modifierPriceMinor: number;
  modifiers: KioskCartItemModifier[];
  quantity: number;
  note?: string;
}

export type KioskPaymentMethod = "PROMPTPAY" | "CASH_COUNTER";

export interface KioskCart {
  storeCode: string;
  fulfillmentType: "DINE_IN" | "TAKEAWAY";
  items: KioskCartItem[];
  paymentMethod: KioskPaymentMethod;
  customerPhone?: string;
}

export function createEmptyKioskCart(storeCode: string): KioskCart {
  return {
    storeCode,
    fulfillmentType: "DINE_IN",
    items: [],
    paymentMethod: "PROMPTPAY"
  };
}

export function addKioskItem(
  cart: KioskCart,
  item: Omit<KioskCartItem, "id" | "modifierPriceMinor">
): KioskCart {
  const modifierPriceMinor = item.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);

  const modKey = (mods: KioskCartItemModifier[]) =>
    mods.map((m) => m.modifierId).sort().join(",");
  const itemModKey = modKey(item.modifiers);

  const existingIdx = cart.items.findIndex(
    (i) =>
      i.productId === item.productId &&
      i.variantId === item.variantId &&
      modKey(i.modifiers) === itemModKey &&
      (i.note || "") === (item.note || "")
  );

  if (existingIdx >= 0) {
    const existing = cart.items[existingIdx]!;
    const updated = { ...existing, quantity: existing.quantity + item.quantity };
    const items = [...cart.items];
    items[existingIdx] = updated;
    return { ...cart, items };
  }

  const newItem: KioskCartItem = {
    id: `kiosk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...item,
    modifierPriceMinor
  };

  return { ...cart, items: [...cart.items, newItem] };
}

export function updateKioskItemQuantity(
  cart: KioskCart,
  itemId: string,
  quantity: number
): KioskCart {
  if (quantity <= 0) {
    return removeKioskItem(cart, itemId);
  }
  return {
    ...cart,
    items: cart.items.map((i) => (i.id === itemId ? { ...i, quantity } : i))
  };
}

export function removeKioskItem(cart: KioskCart, itemId: string): KioskCart {
  return {
    ...cart,
    items: cart.items.filter((i) => i.id !== itemId)
  };
}

export function calculateKioskTotals(cart: KioskCart): OrderTotals {
  const lines: PricingLineInput[] = cart.items.map((item) => ({
    unitPriceMinor: item.unitPriceMinor,
    quantity: item.quantity,
    modifiers: item.modifiers.map((m) => ({ priceDeltaMinor: m.priceDeltaMinor }))
  }));
  return calculateOrderTotals(lines);
}

export function formatBaht(minorUnits: number): string {
  const val = minorUnits / 100;
  return `฿${val.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Idle activity tracker for kiosk.
 * Resets back to attract screen after idleTimeoutSeconds (default 60s).
 */
export class KioskIdleTracker {
  private timeoutId: any = null;
  private warningTimeoutId: any = null;
  private countdownInterval: any = null;

  constructor(
    private readonly idleTimeoutSeconds = 60,
    private readonly warningSeconds = 15,
    private readonly onWarning?: (secondsRemaining: number) => void,
    private readonly onReset?: () => void
  ) {}

  start(): void {
    this.reset();
  }

  reset(): void {
    this.stop();

    const warningDelay = Math.max(0, (this.idleTimeoutSeconds - this.warningSeconds) * 1000);
    this.warningTimeoutId = setTimeout(() => {
      let remaining = this.warningSeconds;
      if (this.onWarning) this.onWarning(remaining);

      this.countdownInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(this.countdownInterval);
        } else if (this.onWarning) {
          this.onWarning(remaining);
        }
      }, 1000);
    }, warningDelay);

    this.timeoutId = setTimeout(() => {
      this.stop();
      if (this.onReset) this.onReset();
    }, this.idleTimeoutSeconds * 1000);
  }

  stop(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.warningTimeoutId) clearTimeout(this.warningTimeoutId);
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.timeoutId = null;
    this.warningTimeoutId = null;
    this.countdownInterval = null;
  }
}

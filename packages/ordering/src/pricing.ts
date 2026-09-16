export interface PricingModifierInput {
  priceDeltaMinor: number;
  quantity?: number;
}

export interface PricingLineInput {
  unitPriceMinor: number;
  quantity: number;
  modifiers?: PricingModifierInput[];
}

export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Pure integer-minor-unit pricing used by order tests and future channels. */
export function calculateOrderTotals(
  lines: readonly PricingLineInput[],
  discountMinor = 0,
  taxMinor = 0
): OrderTotals {
  if (!Number.isInteger(discountMinor) || discountMinor < 0) throw new Error("discountMinor must be a non-negative integer");
  if (!Number.isInteger(taxMinor) || taxMinor < 0) throw new Error("taxMinor must be a non-negative integer");
  const subtotalMinor = lines.reduce((total, line) => {
    if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) throw new Error("unitPriceMinor must be a non-negative integer");
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error("quantity must be a positive integer");
    const modifierMinor = (line.modifiers ?? []).reduce((sum, modifier) => {
      const quantity = modifier.quantity ?? 1;
      if (!Number.isInteger(modifier.priceDeltaMinor) || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("modifier prices and quantities must be integers");
      }
      return sum + modifier.priceDeltaMinor * quantity;
    }, 0);
    const lineTotal = (line.unitPriceMinor + modifierMinor) * line.quantity;
    if (lineTotal < 0) throw new Error("line total cannot be negative");
    return total + lineTotal;
  }, 0);
  if (discountMinor > subtotalMinor) throw new Error("discountMinor cannot exceed subtotalMinor");
  return { subtotalMinor, discountMinor, taxMinor, totalMinor: subtotalMinor - discountMinor + taxMinor };
}

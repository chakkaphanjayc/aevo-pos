export interface ProductMixItem {
  productId: string;
  productName: string;
  quantitySold: number;
  revenueMinor: number;
  percentage: number;
}

export function calculateProductMix(
  items: Array<{ productId: string; productName: string; quantity: number; subtotalMinor: number }>
): ProductMixItem[] {
  const map = new Map<string, { name: string; quantity: number; revenue: number }>();

  let grandTotalRevenue = 0;

  for (const item of items) {
    const existing = map.get(item.productId) ?? { name: item.productName, quantity: 0, revenue: 0 };
    existing.quantity += item.quantity;
    existing.revenue += item.subtotalMinor;
    grandTotalRevenue += item.subtotalMinor;
    map.set(item.productId, existing);
  }

  const result: ProductMixItem[] = [];
  for (const [productId, val] of map.entries()) {
    const percentage = grandTotalRevenue > 0 ? Math.round((val.revenue / grandTotalRevenue) * 1000) / 10 : 0;
    result.push({
      productId,
      productName: val.name,
      quantitySold: val.quantity,
      revenueMinor: val.revenue,
      percentage
    });
  }

  return result.sort((a, b) => b.revenueMinor - a.revenueMinor);
}

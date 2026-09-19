export interface HourlySalesBucket {
  hour: number;
  orderCount: number;
  revenueMinor: number;
}

export function calculateHourlySales(
  orders: Array<{ createdAt: string; totalMinor: number; status: string }>
): HourlySalesBucket[] {
  const buckets: HourlySalesBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orderCount: 0,
    revenueMinor: 0
  }));

  for (const o of orders) {
    if (["DRAFT", "PENDING_PAYMENT", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "NO_SHOW"].includes(o.status)) continue;
    const date = new Date(o.createdAt);
    const h = date.getHours();
    if (h >= 0 && h < 24) {
      const bucket = buckets[h]!;
      bucket.orderCount += 1;
      bucket.revenueMinor += o.totalMinor;
    }
  }

  return buckets;
}

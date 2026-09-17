export interface DailySalesSummary {
  date: string;
  totalRevenueMinor: number;
  orderCount: number;
  averageTicketMinor: number;
  cashRevenueMinor: number;
  promptpayRevenueMinor: number;
}

export function calculateDailySummary(
  date: string,
  orders: Array<{ totalMinor: number; status: string }>,
  payments: Array<{ method: string; amountMinor: number }>
): DailySalesSummary {
  const activeOrders = orders.filter((o) => o.status !== "CANCELLED" && o.status !== "REFUNDED");
  const totalRevenueMinor = activeOrders.reduce((sum, o) => sum + o.totalMinor, 0);
  const orderCount = activeOrders.length;
  const averageTicketMinor = orderCount > 0 ? Math.round(totalRevenueMinor / orderCount) : 0;

  let cashRevenueMinor = 0;
  let promptpayRevenueMinor = 0;

  for (const p of payments) {
    if (p.method === "CASH") {
      cashRevenueMinor += p.amountMinor;
    } else if (p.method === "PROMPTPAY" || p.method === "QR") {
      promptpayRevenueMinor += p.amountMinor;
    }
  }

  return {
    date,
    totalRevenueMinor,
    orderCount,
    averageTicketMinor,
    cashRevenueMinor,
    promptpayRevenueMinor
  };
}

import { describe, expect, it } from "bun:test";
import {
  calculateDailySummary,
  calculateHourlySales,
  calculateProductMix,
  generateCashSessionReport
} from "../src";

describe("reporting package", () => {
  it("calculates daily sales summary and breakdown correctly", () => {
    const orders = [
      { totalMinor: 15000, status: "PAID" },
      { totalMinor: 25000, status: "COMPLETED" },
      { totalMinor: 10000, status: "CANCELLED" }
    ];
    const payments = [
      { method: "CASH", amountMinor: 15000 },
      { method: "PROMPTPAY", amountMinor: 25000 }
    ];

    const summary = calculateDailySummary("2026-09-17", orders, payments);
    expect(summary.totalRevenueMinor).toBe(40000);
    expect(summary.orderCount).toBe(2);
    expect(summary.averageTicketMinor).toBe(20000);
    expect(summary.cashRevenueMinor).toBe(15000);
    expect(summary.promptpayRevenueMinor).toBe(25000);
  });

  it("calculates product mix and revenue percentages", () => {
    const items = [
      { productId: "p-1", productName: "Latte", quantity: 2, subtotalMinor: 14000 },
      { productId: "p-2", productName: "Croissant", quantity: 1, subtotalMinor: 6000 },
      { productId: "p-1", productName: "Latte", quantity: 1, subtotalMinor: 7000 }
    ];

    const mix = calculateProductMix(items);
    expect(mix).toHaveLength(2);
    expect(mix[0]!.productName).toBe("Latte");
    expect(mix[0]!.quantitySold).toBe(3);
    expect(mix[0]!.revenueMinor).toBe(21000);
    // 21000 / 27000 = 77.8%
    expect(mix[0]!.percentage).toBe(77.8);
  });

  it("distributes hourly sales into 24-hour buckets", () => {
    const orders = [
      { createdAt: "2026-09-17T09:15:00Z", totalMinor: 5000, status: "COMPLETED" },
      { createdAt: "2026-09-17T09:45:00Z", totalMinor: 7000, status: "COMPLETED" }
    ];

    const buckets = calculateHourlySales(orders);
    expect(buckets).toHaveLength(24);
    const hour = new Date("2026-09-17T09:15:00Z").getHours();
    expect(buckets[hour]!.orderCount).toBe(2);
    expect(buckets[hour]!.revenueMinor).toBe(12000);
  });

  it("evaluates cash session difference accurately", () => {
    const session = {
      id: "sess-1",
      opening_amount_minor: 200000, // 2,000 THB
      closing_amount_minor: 345000, // 3,450 THB
      status: "CLOSED" as const
    };
    const cashPayments = [
      { amountMinor: 100000 },
      { amountMinor: 50000 }
    ]; // 1,500 THB cash sales -> Expected 3,500 THB -> Short by 50 THB (-5000 minor)

    const report = generateCashSessionReport(session, cashPayments);
    expect(report.expectedAmountMinor).toBe(350000);
    expect(report.cashDifferenceMinor).toBe(-5000);
    expect(report.cashSalesTotalMinor).toBe(150000);
  });
});

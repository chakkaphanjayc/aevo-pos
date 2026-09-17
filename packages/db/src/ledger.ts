import type {
  DailyClosingSummary,
  SalesLedgerEntrySummary,
  SessionPrincipal
} from "@aevo/contracts";
import type { Database } from "./client";

type Row = Record<string, unknown>;

function mapDailyClosing(row: Row): DailyClosingSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    closingDate: String(row.closing_date),
    grossSalesMinor: Number(row.gross_sales_minor ?? 0),
    netSalesMinor: Number(row.net_sales_minor ?? 0),
    discountsMinor: Number(row.discounts_minor ?? 0),
    taxMinor: Number(row.tax_minor ?? 0),
    cashSalesMinor: Number(row.cash_sales_minor ?? 0),
    promptpaySalesMinor: Number(row.promptpay_sales_minor ?? 0),
    cardSalesMinor: Number(row.card_sales_minor ?? 0),
    refundsMinor: Number(row.refunds_minor ?? 0),
    voidsMinor: Number(row.voids_minor ?? 0),
    totalOrders: Number(row.total_orders ?? 0),
    closedBy: String(row.closed_by),
    createdAt: String(row.created_at)
  };
}

export async function createDailyClosing(
  database: Database,
  principal: SessionPrincipal,
  input: {
    storeId: string;
    closingDate: string; // YYYY-MM-DD
  }
): Promise<DailyClosingSummary> {
  const startOfDay = `${input.closingDate}T00:00:00.000Z`;
  const endOfDay = `${input.closingDate}T23:59:59.999Z`;

  // Fetch orders for this date
  const ordersRes = await database.client
    .from("orders")
    .select("status, payment_status, subtotal_minor, discount_minor, tax_minor, total_minor")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .gte("created_at", startOfDay)
    .lte("created_at", endOfDay);

  const orders = (ordersRes.data ?? []) as Row[];

  let grossSales = 0;
  let netSales = 0;
  let discounts = 0;
  let tax = 0;
  let voids = 0;
  let totalOrders = 0;

  for (const o of orders) {
    if (o.status === "CANCELLED") {
      voids += Number(o.total_minor ?? 0);
      continue;
    }
    totalOrders++;
    grossSales += Number(o.subtotal_minor ?? 0);
    discounts += Number(o.discount_minor ?? 0);
    tax += Number(o.tax_minor ?? 0);
    netSales += Number(o.total_minor ?? 0);
  }

  // Fetch payments for this date
  const paymentsRes = await database.client
    .from("payments")
    .select("method, amount_minor")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .gte("created_at", startOfDay)
    .lte("created_at", endOfDay);

  let cashSales = 0;
  let promptpaySales = 0;
  let cardSales = 0;

  for (const p of (paymentsRes.data ?? []) as Row[]) {
    const amt = Number(p.amount_minor ?? 0);
    if (p.method === "CASH") cashSales += amt;
    else if (p.method === "PROMPTPAY") promptpaySales += amt;
    else if (p.method === "EXTERNAL_CARD") cardSales += amt;
  }

  // Fetch refunds for this date
  const refundsRes = await database.client
    .from("refunds")
    .select("amount_minor")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .gte("created_at", startOfDay)
    .lte("created_at", endOfDay);

  const refunds = (refundsRes.data ?? []).reduce(
    (acc, curr) => acc + Number(curr.amount_minor ?? 0),
    0
  );

  const upsertData = {
    organization_id: principal.organizationId,
    store_id: input.storeId,
    closing_date: input.closingDate,
    gross_sales_minor: grossSales,
    net_sales_minor: netSales,
    discounts_minor: discounts,
    tax_minor: tax,
    cash_sales_minor: cashSales,
    promptpay_sales_minor: promptpaySales,
    card_sales_minor: cardSales,
    refunds_minor: refunds,
    voids_minor: voids,
    total_orders: totalOrders,
    closed_by: principal.userId || "00000000-0000-0000-0000-000000000000"
  };

  const { data, error } = await database.client
    .from("daily_closings")
    .upsert(upsertData, { onConflict: "organization_id, store_id, closing_date" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create daily closing: ${error?.message}`);
  }

  return mapDailyClosing(data as Row);
}

export async function getDailyClosing(
  database: Database,
  principal: SessionPrincipal,
  storeId: string,
  closingDate: string
): Promise<DailyClosingSummary | null> {
  const { data, error } = await database.client
    .from("daily_closings")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .eq("closing_date", closingDate)
    .maybeSingle();

  if (error || !data) return null;
  return mapDailyClosing(data as Row);
}

export async function listDailyClosings(
  database: Database,
  principal: SessionPrincipal,
  storeId: string,
  limit = 30
): Promise<DailyClosingSummary[]> {
  const { data, error } = await database.client
    .from("daily_closings")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .order("closing_date", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as Row[]).map((row) => mapDailyClosing(row));
}

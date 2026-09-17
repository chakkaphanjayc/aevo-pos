import type { ReceiptItemSnapshot, ReceiptSummary, SessionPrincipal } from "@aevo/contracts";
import type { Database } from "./client";

type Row = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapReceipt(row: Row): ReceiptSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    orderId: String(row.order_id),
    receiptNumber: String(row.receipt_number),
    orderNumber: String(row.order_number),
    storeSnapshot: (row.store_snapshot as ReceiptSummary["storeSnapshot"]) || {
      name: "AEVO Store",
      code: "STORE"
    },
    itemsSnapshot: (row.items_snapshot as ReceiptItemSnapshot[]) || [],
    subtotalMinor: Number(row.subtotal_minor ?? 0),
    discountMinor: Number(row.discount_minor ?? 0),
    taxMinor: Number(row.tax_minor ?? 0),
    totalMinor: Number(row.total_minor ?? 0),
    paymentsSummary: (row.payments_summary as ReceiptSummary["paymentsSummary"]) || [],
    ...(row.cash_received_minor !== null && row.cash_received_minor !== undefined
      ? { cashReceivedMinor: Number(row.cash_received_minor) }
      : {}),
    ...(row.change_minor !== null && row.change_minor !== undefined
      ? { changeMinor: Number(row.change_minor) }
      : {}),
    ...(optionalString(row.cashier_name) ? { cashierName: String(row.cashier_name) } : {}),
    reprintCount: Number(row.reprint_count ?? 0),
    ...(optionalString(row.last_reprinted_at) ? { lastReprintedAt: String(row.last_reprinted_at) } : {}),
    isVoid: row.is_void === true,
    ...(optionalString(row.void_reason) ? { voidReason: String(row.void_reason) } : {}),
    ...(optionalString(row.voided_at) ? { voidedAt: String(row.voided_at) } : {}),
    ...(optionalString(row.voided_by) ? { voidedBy: String(row.voided_by) } : {}),
    createdAt: String(row.created_at)
  };
}

export async function createReceiptFromOrder(
  database: Database,
  principal: SessionPrincipal,
  input: {
    orderId: string;
    storeId: string;
    cashReceivedMinor?: number;
    cashierName?: string;
  }
): Promise<ReceiptSummary> {
  // Check if receipt already exists for this order
  const existing = await database.client
    .from("receipts")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("order_id", input.orderId)
    .maybeSingle();

  if (existing.data) {
    return mapReceipt(existing.data as Row);
  }

  // Load Order
  const orderRes = await database.client
    .from("orders")
    .select("*, order_items(*, order_item_modifiers(*))")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .eq("id", input.orderId)
    .single();

  if (orderRes.error || !orderRes.data) {
    throw new Error(`Order ${input.orderId} not found`);
  }

  const order = orderRes.data;

  // Load Store
  const storeRes = await database.client
    .from("stores")
    .select("name, code")
    .eq("organization_id", principal.organizationId)
    .eq("id", input.storeId)
    .maybeSingle();

  const storeSnapshot = {
    name: storeRes.data?.name ?? "AEVO Store",
    code: storeRes.data?.code ?? "STORE"
  };

  // Load Payments
  const paymentsRes = await database.client
    .from("payments")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("order_id", input.orderId);

  const paymentsSummary = (paymentsRes.data ?? []).map((p) => ({
    method: p.method as any,
    amountMinor: Number(p.amount_minor ?? 0),
    reference: p.provider_reference ? String(p.provider_reference) : null,
    paidAt: String(p.created_at)
  }));

  // Map item snapshots
  const itemsSnapshot: ReceiptItemSnapshot[] = ((order.order_items as any[]) ?? []).map((item) => ({
    productName: String(item.product_name),
    variantName: item.variant_name ? String(item.variant_name) : null,
    quantity: Number(item.quantity ?? 1),
    unitPriceMinor: Number(item.unit_price_minor ?? 0),
    subtotalMinor: Number(item.subtotal_minor ?? 0),
    modifiers: ((item.order_item_modifiers as any[]) ?? []).map((mod) => ({
      name: String(mod.name),
      priceMinor: Number(mod.price_delta_minor ?? 0)
    }))
  }));

  const subtotalMinor = Number(order.subtotal_minor ?? 0);
  const discountMinor = Number(order.discount_minor ?? 0);
  const taxMinor = Number(order.tax_minor ?? 0);
  const totalMinor = Number(order.total_minor ?? 0);

  const cashReceived = input.cashReceivedMinor;
  const changeMinor = cashReceived !== undefined && cashReceived >= totalMinor
    ? cashReceived - totalMinor
    : 0;

  // Format Receipt Number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const orderNumStr = order.order_number ? String(order.order_number) : order.id.slice(0, 6).toUpperCase();
  const receiptNumber = `RCP-${dateStr}-${orderNumStr}`;

  const insertData = {
    organization_id: principal.organizationId,
    store_id: input.storeId,
    order_id: input.orderId,
    receipt_number: receiptNumber,
    order_number: order.order_number ? String(order.order_number) : order.id.slice(0, 8),
    store_snapshot: storeSnapshot,
    items_snapshot: itemsSnapshot,
    subtotal_minor: subtotalMinor,
    discount_minor: discountMinor,
    tax_minor: taxMinor,
    total_minor: totalMinor,
    payments_summary: paymentsSummary,
    cash_received_minor: cashReceived ?? null,
    change_minor: changeMinor,
    cashier_name: input.cashierName || principal.email || "Staff",
    reprint_count: 0
  };

  const { data, error } = await database.client
    .from("receipts")
    .insert(insertData)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create receipt: ${error?.message}`);
  }

  return mapReceipt(data as Row);
}

export async function getReceiptByOrderId(
  database: Database,
  principal: SessionPrincipal,
  orderId: string
): Promise<ReceiptSummary | null> {
  const { data, error } = await database.client
    .from("receipts")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (error || !data) return null;
  return mapReceipt(data as Row);
}

export async function getReceiptById(
  database: Database,
  principal: SessionPrincipal,
  receiptId: string
): Promise<ReceiptSummary | null> {
  const { data, error } = await database.client
    .from("receipts")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("id", receiptId)
    .maybeSingle();

  if (error || !data) return null;
  return mapReceipt(data as Row);
}

export async function reprintReceipt(
  database: Database,
  principal: SessionPrincipal,
  receiptId: string,
  storeId?: string
): Promise<ReceiptSummary> {
  const existing = await getReceiptById(database, principal, receiptId);
  if (!existing) {
    throw new Error("Receipt not found");
  }
  if (storeId && existing.storeId !== storeId) {
    throw new Error("Receipt does not belong to this store");
  }

  const { data, error } = await database.client
    .from("receipts")
    .update({
      reprint_count: existing.reprintCount + 1,
      last_reprinted_at: new Date().toISOString()
    })
    .eq("organization_id", principal.organizationId)
    .eq("id", receiptId)
    .eq(storeId ? "store_id" : "id", storeId ?? receiptId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to reprint receipt: ${error?.message}`);
  }

  return mapReceipt(data as Row);
}

export async function voidReceipt(
  database: Database,
  principal: SessionPrincipal,
  receiptId: string,
  reason: string,
  storeId?: string
): Promise<ReceiptSummary> {
  const existing = await getReceiptById(database, principal, receiptId);
  if (!existing) {
    throw new Error("Receipt not found");
  }
  if (storeId && existing.storeId !== storeId) {
    throw new Error("Receipt does not belong to this store");
  }

  const { data, error } = await database.client
    .from("receipts")
    .update({
      is_void: true,
      void_reason: reason.trim(),
      voided_at: new Date().toISOString(),
      voided_by: principal.userId || null
    })
    .eq("organization_id", principal.organizationId)
    .eq("id", receiptId)
    .eq(storeId ? "store_id" : "id", storeId ?? receiptId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to void receipt: ${error?.message}`);
  }

  return mapReceipt(data as Row);
}

export function formatReceiptThermalText(receipt: ReceiptSummary, paperWidth: 58 | 80 = 80): string {
  const width = paperWidth === 58 ? 32 : 42;
  const line = "-".repeat(width);
  const doubleLine = "=".repeat(width);

  const center = (text: string) => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return " ".repeat(pad) + text;
  };

  const row = (left: string, right: string) => {
    const space = Math.max(1, width - left.length - right.length);
    return left + " ".repeat(space) + right;
  };

  const fmtMinor = (val: number) => (val / 100).toFixed(2);

  const lines: string[] = [
    doubleLine,
    center(receipt.storeSnapshot.name),
    center(`สาขา: ${receipt.storeSnapshot.code}`),
    doubleLine,
    `ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ`,
    `เลขที่: ${receipt.receiptNumber}`,
    `ออเดอร์: #${receipt.orderNumber}`,
    `วันที่: ${new Date(receipt.createdAt).toLocaleString("th-TH")}`,
    receipt.cashierName ? `พนักงาน: ${receipt.cashierName}` : "",
    line
  ].filter(Boolean);

  if (receipt.reprintCount > 0) {
    lines.push(center(`** สำเนาพิมพ์ซ้ำ (ครั้งที่ ${receipt.reprintCount}) **`));
  }
  if (receipt.isVoid) {
    lines.push(center(`*** ยกเลิก / VOID (${receipt.voidReason || "-"}) ***`));
  }

  lines.push(line);

  // Items
  for (const item of receipt.itemsSnapshot) {
    const nameStr = `${item.quantity}x ${item.productName}${item.variantName ? ` (${item.variantName})` : ""}`;
    const priceStr = fmtMinor(item.subtotalMinor);
    lines.push(row(nameStr, priceStr));

    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        lines.push(`   + ${mod.name} (+฿${fmtMinor(mod.priceMinor)})`);
      }
    }
  }

  lines.push(line);
  lines.push(row("ยอดรวม (Subtotal):", `฿${fmtMinor(receipt.subtotalMinor)}`));
  if (receipt.discountMinor > 0) {
    lines.push(row("ส่วนลด (Discount):", `-฿${fmtMinor(receipt.discountMinor)}`));
  }
  if (receipt.taxMinor > 0) {
    lines.push(row("ภาษีมูลค่าเพิ่ม (VAT 7%):", `฿${fmtMinor(receipt.taxMinor)}`));
  }
  lines.push(doubleLine);
  lines.push(row("ยอดสุทธิ (Total):", `฿${fmtMinor(receipt.totalMinor)}`));
  lines.push(doubleLine);

  // Payments
  for (const p of receipt.paymentsSummary) {
    lines.push(row(`ชำระด้วย ${p.method}:`, `฿${fmtMinor(p.amountMinor)}`));
  }
  if (receipt.cashReceivedMinor !== undefined && receipt.cashReceivedMinor !== null) {
    lines.push(row("รับเงินสด:", `฿${fmtMinor(receipt.cashReceivedMinor)}`));
    lines.push(row("เงินทอน:", `฿${fmtMinor(receipt.changeMinor ?? 0)}`));
  }

  lines.push(line);
  lines.push(center("ขอบคุณที่ใช้บริการ"));
  lines.push(center("Thank You / Please Come Again"));
  lines.push(doubleLine);

  return lines.join("\n");
}

import type { RefundResult, SessionPrincipal } from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

export class RefundError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RefundError";
  }
}

function firstRow(data: unknown): Row | undefined {
  if (Array.isArray(data)) return data[0] as Row | undefined;
  return data && typeof data === "object" ? data as Row : undefined;
}

export async function recordOrderRefund(
  database: Database,
  principal: SessionPrincipal,
  input: {
    storeId: string;
    orderId: string;
    amountMinor: number;
    reason: string;
  },
  idempotencyKey: string
): Promise<RefundResult> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new RefundError("REFUND_VALIDATION_ERROR", "Refund amount must be positive");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new RefundError("REFUND_VALIDATION_ERROR", "Refund reason is required");
  }
  if (!idempotencyKey.trim()) {
    throw new RefundError("REFUND_VALIDATION_ERROR", "Idempotency-Key is required for refunds");
  }

  const result = await database.client.rpc("record_order_refund", {
    p_organization_id: principal.organizationId,
    p_store_id: input.storeId,
    p_order_id: input.orderId,
    p_created_by: principal.userId,
    p_amount_minor: input.amountMinor,
    p_reason: reason,
    p_idempotency_key: idempotencyKey.trim()
  });

  if (result.error) {
    if (result.error.code === "40001") throw new RefundError("REFUND_CONFLICT", result.error.message);
    if (result.error.code === "P0002") throw new RefundError("ORDER_NOT_FOUND", result.error.message);
    if (result.error.code === "22023") throw new RefundError("REFUND_VALIDATION_ERROR", result.error.message);
    throwDatabaseError(result.error, "refund command");
  }

  const row = firstRow(result.data);
  if (!row?.refund_id || !row.order_id) {
    throw new RefundError("REFUND_COMMAND_FAILED", "Refund command returned no refund");
  }

  return {
    refundId: String(row.refund_id),
    orderId: String(row.order_id),
    amountMinor: input.amountMinor,
    refundedAmountMinor: Number(row.refunded_amount_minor ?? input.amountMinor),
    orderStatus: String(row.order_status) as RefundResult["orderStatus"],
    paymentStatus: String(row.payment_status) as RefundResult["paymentStatus"],
    idempotent: row.idempotent === true
  };
}

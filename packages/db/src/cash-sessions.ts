import type {
  CashMovementSummary,
  CashMovementType,
  CashSessionDetail,
  SessionPrincipal
} from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapCashMovement(row: Row): CashMovementSummary {
  return {
    id: String(row.id),
    cashSessionId: String(row.cash_session_id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    movementType: String(row.movement_type) as CashMovementType,
    amountMinor: Number(row.amount_minor ?? 0),
    reason: String(row.reason ?? ""),
    performedBy: String(row.performed_by),
    createdAt: String(row.created_at)
  };
}

function mapCashSession(row: Row, movements: CashMovementSummary[] = []): CashSessionDetail {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    openedBy: String(row.opened_by),
    ...(optionalString(row.closed_by) ? { closedBy: String(row.closed_by) } : {}),
    openingAmountMinor: Number(row.opening_amount_minor ?? 0),
    ...(row.closing_amount_minor !== null && row.closing_amount_minor !== undefined
      ? { closingAmountMinor: Number(row.closing_amount_minor) }
      : {}),
    ...(row.expected_amount_minor !== null && row.expected_amount_minor !== undefined
      ? { expectedAmountMinor: Number(row.expected_amount_minor) }
      : {}),
    ...(row.cash_difference_minor !== null && row.cash_difference_minor !== undefined
      ? { cashDifferenceMinor: Number(row.cash_difference_minor) }
      : {}),
    status: row.status === "CLOSED" ? "CLOSED" : "OPEN",
    openedAt: String(row.opened_at),
    ...(optionalString(row.closed_at) ? { closedAt: String(row.closed_at) } : {}),
    ...(optionalString(row.notes) ? { notes: String(row.notes) } : {}),
    movements
  };
}

export async function getCurrentCashSession(
  database: Database,
  principal: SessionPrincipal,
  storeId: string
): Promise<CashSessionDetail | null> {
  const sessionRes = await database.client
    .from("cash_sessions")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .eq("status", "OPEN")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  throwDatabaseError(sessionRes.error, "cash session lookup");
  if (!sessionRes.data) return null;

  const session = sessionRes.data as Row;

  // Load movements
  const movementsRes = await database.client
    .from("cash_movements")
    .select("*")
    .eq("cash_session_id", String(session.id))
    .order("created_at", { ascending: true });
  throwDatabaseError(movementsRes.error, "cash movement lookup");

  const movements = (movementsRes.data ?? []).map((m) => mapCashMovement(m as Row));

  // Calculate live cash sales since session opened
  const paymentsRes = await database.client
    .from("payments")
    .select("amount_minor")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .eq("method", "CASH")
    .eq("status", "PAID")
    .gte("created_at", String(session.opened_at));
  throwDatabaseError(paymentsRes.error, "cash payment lookup");

  const cashSalesMinor = (paymentsRes.data ?? []).reduce(
    (acc, curr) => acc + Number(curr.amount_minor ?? 0),
    0
  );

  const mapped = mapCashSession(session, movements);
  mapped.cashSalesMinor = cashSalesMinor;

  return mapped;
}

export async function openCashSession(
  database: Database,
  principal: SessionPrincipal,
  input: {
    storeId: string;
    openingAmountMinor: number;
    notes?: string;
  }
): Promise<CashSessionDetail> {
  // Check if open session exists
  const current = await getCurrentCashSession(database, principal, input.storeId);
  if (current) {
    return current;
  }

  const { data, error } = await database.client
    .from("cash_sessions")
    .insert({
      organization_id: principal.organizationId,
      store_id: input.storeId,
      opened_by: principal.userId || "00000000-0000-0000-0000-000000000000",
      opening_amount_minor: input.openingAmountMinor,
      status: "OPEN",
      notes: input.notes?.trim() || null
    })
    .select("*")
    .single();

  if (error?.code === "23505") {
    const concurrent = await getCurrentCashSession(database, principal, input.storeId);
    if (concurrent) return concurrent;
  }
  throwDatabaseError(error, "cash session open");
  if (!data) throw new Error("Failed to open cash session: no session was returned");

  return mapCashSession(data as Row, []);
}

export async function recordCashMovement(
  database: Database,
  principal: SessionPrincipal,
  input: {
    cashSessionId: string;
    storeId: string;
    movementType: CashMovementType;
    amountMinor: number;
    reason: string;
  }
): Promise<CashMovementSummary> {
  const sessionRes = await database.client
    .from("cash_sessions")
    .select("id, status")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .eq("id", input.cashSessionId)
    .maybeSingle();
  throwDatabaseError(sessionRes.error, "cash movement session lookup");
  if (!sessionRes.data) throw new Error("Cash session not found in the selected store");
  if (String((sessionRes.data as Row).status) !== "OPEN") {
    throw new Error("Cash movements can only be recorded on an open session");
  }

  const { data, error } = await database.client
    .from("cash_movements")
    .insert({
      cash_session_id: input.cashSessionId,
      organization_id: principal.organizationId,
      store_id: input.storeId,
      movement_type: input.movementType,
      amount_minor: input.amountMinor,
      reason: input.reason.trim(),
      performed_by: principal.userId || "00000000-0000-0000-0000-000000000000"
    })
    .select("*")
    .single();

  throwDatabaseError(error, "cash movement create");
  if (!data) throw new Error("Failed to record cash movement: no movement was returned");

  return mapCashMovement(data as Row);
}

export async function closeCashSession(
  database: Database,
  principal: SessionPrincipal,
  input: {
    cashSessionId: string;
    storeId: string;
    countedAmountMinor: number;
    notes?: string;
  }
): Promise<CashSessionDetail> {
  const sessionRes = await database.client
    .from("cash_sessions")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("id", input.cashSessionId)
    .single();

  throwDatabaseError(sessionRes.error, "cash session close lookup");
  if (!sessionRes.data) throw new Error("Cash session not found");

  const session = sessionRes.data as Row;
  if (String(session.store_id) !== input.storeId) {
    throw new Error("Cash session does not belong to this store");
  }
  if (String(session.status) !== "OPEN") {
    throw new Error("Cash session is already closed");
  }
  const openingAmount = Number(session.opening_amount_minor ?? 0);

  // Movements sum
  const movementsRes = await database.client
    .from("cash_movements")
    .select("*")
    .eq("cash_session_id", input.cashSessionId);
  throwDatabaseError(movementsRes.error, "cash movement close lookup");

  const movements = (movementsRes.data ?? []).map((m) => mapCashMovement(m as Row));
  let netMovements = 0;
  for (const m of movements) {
    if (m.movementType === "IN" || m.movementType === "PAID_IN") {
      netMovements += m.amountMinor;
    } else {
      netMovements -= m.amountMinor;
    }
  }

  // Cash sales during session
  const paymentsRes = await database.client
    .from("payments")
    .select("amount_minor")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .eq("method", "CASH")
    .eq("status", "PAID")
    .gte("created_at", String(session.opened_at));
  throwDatabaseError(paymentsRes.error, "cash payment close lookup");

  const cashSales = (paymentsRes.data ?? []).reduce(
    (acc, curr) => acc + Number(curr.amount_minor ?? 0),
    0
  );

  const expectedAmount = openingAmount + cashSales + netMovements;
  const cashDifference = input.countedAmountMinor - expectedAmount;

  const { data, error } = await database.client
    .from("cash_sessions")
    .update({
      status: "CLOSED",
      closed_by: principal.userId || "00000000-0000-0000-0000-000000000000",
      closed_at: new Date().toISOString(),
      closing_amount_minor: input.countedAmountMinor,
      expected_amount_minor: expectedAmount,
      cash_difference_minor: cashDifference,
      notes: input.notes?.trim() || session.notes
    })
    .eq("organization_id", principal.organizationId)
    .eq("id", input.cashSessionId)
    .eq("status", "OPEN")
    .select("*")
    .single();

  throwDatabaseError(error, "cash session close");
  if (!data) throw new Error("Failed to close cash session: no session was returned");

  return mapCashSession(data as Row, movements);
}

export async function listCashSessions(
  database: Database,
  principal: SessionPrincipal,
  storeId: string,
  limit = 20
): Promise<CashSessionDetail[]> {
  const { data, error } = await database.client
    .from("cash_sessions")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .order("opened_at", { ascending: false })
    .limit(limit);

  throwDatabaseError(error, "cash session history");
  if (!data) return [];
  return (data as Row[]).map((row) => mapCashSession(row, []));
}

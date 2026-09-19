import type {
  QueueConfigSummary,
  QueueDisplaySnapshot,
  QueueTicketStatus,
  QueueTicketSummary
} from "@aevo/contracts";
import type { Database } from "./client";
import { getStoreByCode } from "./catalog";
import { throwDatabaseError } from "./errors";

export class QueueError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "QueueError";
  }
}

type Row = Record<string, unknown>;

export function formatQueueNumber(prefix: string, seq: number): string {
  const cleanPrefix = (prefix || "Q").trim().toUpperCase();
  return `${cleanPrefix}-${String(seq).padStart(3, "0")}`;
}

export async function getOrCreateQueueConfig(
  database: Database,
  organizationId: string,
  storeId: string
): Promise<QueueConfigSummary> {
  const { data, error } = await database.client
    .from("queue_configs")
    .select("organization_id, store_id, prefix, reset_daily, display_mode")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throwDatabaseError(error, "queue config lookup");
    throw new QueueError("QUEUE_CONFIG_READ_FAILED", error.message);
  }

  if (data) {
    return {
      organizationId: data.organization_id,
      storeId: data.store_id,
      prefix: data.prefix ?? "Q",
      resetDaily: data.reset_daily ?? true,
      displayMode: data.display_mode ?? "NUMBER"
    };
  }

  // Insert default config
  const defaultConfig = {
    organization_id: organizationId,
    store_id: storeId,
    prefix: "Q",
    reset_daily: true,
    display_mode: "NUMBER"
  };

  const { data: inserted, error: insertError } = await database.client
    .from("queue_configs")
    .upsert(defaultConfig, { onConflict: "organization_id,store_id" })
    .select("organization_id, store_id, prefix, reset_daily, display_mode")
    .single();

  if (insertError) {
    throwDatabaseError(insertError, "queue config create");
    throw new QueueError("QUEUE_CONFIG_CREATE_FAILED", insertError.message);
  }

  return {
    organizationId: inserted.organization_id,
    storeId: inserted.store_id,
    prefix: inserted.prefix ?? "Q",
    resetDaily: inserted.reset_daily ?? true,
    displayMode: inserted.display_mode ?? "NUMBER"
  };
}

export async function createQueueTicket(
  database: Database,
  params: {
    organizationId: string;
    storeId: string;
    orderId: string;
    orderNumber?: string;
    prefix?: string;
  }
): Promise<QueueTicketSummary> {
  // Check if ticket already exists for this order
  const existing = await getQueueTicketByOrderId(database, params.orderId);
  if (existing) {
    return existing;
  }

  const config = await getOrCreateQueueConfig(database, params.organizationId, params.storeId);
  const today = new Date().toISOString().split("T")[0] ?? "1970-01-01";
  const businessDate = config.resetDaily ? today : "1970-01-01";
  const prefix = params.prefix ?? config.prefix;

  // The production migration exposes an atomic upsert RPC. The fallback keeps
  // the small repository unit tests useful when they provide only .from().
  let nextSeq: number;
  if (typeof database.client.rpc === "function") {
    const sequenceResult = await database.client.rpc("next_queue_number", {
      p_organization_id: params.organizationId,
      p_store_id: params.storeId,
      p_business_date: businessDate
    });
    throwDatabaseError(sequenceResult.error, "queue sequence allocation");
    const rawSequence = Array.isArray(sequenceResult.data)
      ? (sequenceResult.data[0] as Row | number | undefined)
      : sequenceResult.data;
    const sequenceValue = typeof rawSequence === "object" && rawSequence !== null
      ? rawSequence.next_queue_number
      : rawSequence;
    nextSeq = Number(sequenceValue);
    if (!Number.isInteger(nextSeq) || nextSeq < 1) {
      throw new QueueError("QUEUE_SEQUENCE_INVALID", "Queue sequence allocation returned an invalid number");
    }
  } else {
    const { data: seqRow, error: seqReadError } = await database.client
      .from("queue_sequences")
      .select("next_value")
      .eq("organization_id", params.organizationId)
      .eq("store_id", params.storeId)
      .eq("business_date", businessDate)
      .maybeSingle();
    throwDatabaseError(seqReadError, "queue sequence lookup");

    nextSeq = Number(seqRow?.next_value ?? 1);
    if (seqRow) {
      const updateResult = await database.client
        .from("queue_sequences")
        .update({ next_value: nextSeq + 1 })
        .eq("organization_id", params.organizationId)
        .eq("store_id", params.storeId)
        .eq("business_date", businessDate);
      throwDatabaseError(updateResult.error, "queue sequence update");
    } else {
      const insertResult = await database.client
        .from("queue_sequences")
        .insert({
          organization_id: params.organizationId,
          store_id: params.storeId,
          business_date: businessDate,
          next_value: nextSeq + 1
        });
      throwDatabaseError(insertResult.error, "queue sequence create");
    }
  }

  const queueNumber = formatQueueNumber(prefix, nextSeq);

  const { data, error } = await database.client
    .from("queue_tickets")
    .insert({
      organization_id: params.organizationId,
      store_id: params.storeId,
      order_id: params.orderId,
      queue_number: queueNumber,
      status: "WAITING"
    })
    .select("id, organization_id, store_id, order_id, queue_number, status, called_at, completed_at, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      const concurrent = await getQueueTicketByOrderId(database, params.orderId);
      if (concurrent) return concurrent;
    }
    throwDatabaseError(error, "queue ticket create");
    throw new QueueError("QUEUE_TICKET_CREATE_FAILED", error.message);
  }

  return mapQueueTicketRow(data as Row, params.orderNumber);
}

export async function getQueueTicketByOrderId(
  database: Database,
  orderId: string
): Promise<QueueTicketSummary | null> {
  const { data, error } = await database.client
    .from("queue_tickets")
    .select("id, organization_id, store_id, order_id, queue_number, status, called_at, completed_at, created_at")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) throwDatabaseError(error, "queue ticket order lookup");
  if (!data) return null;
  return mapQueueTicketRow(data as Row);
}

export async function getQueueTicketById(
  database: Database,
  ticketId: string
): Promise<QueueTicketSummary | null> {
  const { data, error } = await database.client
    .from("queue_tickets")
    .select("id, organization_id, store_id, order_id, queue_number, status, called_at, completed_at, created_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (error) throwDatabaseError(error, "queue ticket lookup");
  if (!data) return null;
  return mapQueueTicketRow(data as Row);
}

export async function listQueueTickets(
  database: Database,
  params: {
    storeId: string;
    statuses?: QueueTicketStatus[];
    limit?: number;
  }
): Promise<QueueTicketSummary[]> {
  let query = database.client
    .from("queue_tickets")
    .select("id, organization_id, store_id, order_id, queue_number, status, called_at, completed_at, created_at")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: true })
    .limit(params.limit ?? 100);

  if (params.statuses && params.statuses.length > 0) {
    query = query.in("status", params.statuses);
  }

  const { data, error } = await query;
  if (error) {
    throwDatabaseError(error, "queue ticket list");
    throw new QueueError("QUEUE_TICKETS_LIST_FAILED", error.message);
  }

  return (data || []).map((row) => mapQueueTicketRow(row as Row));
}

export async function transitionQueueTicket(
  database: Database,
  ticketId: string,
  nextStatus: QueueTicketStatus
): Promise<QueueTicketSummary> {
  const updates: Record<string, unknown> = {
    status: nextStatus,
    updated_at: new Date().toISOString()
  };

  if (nextStatus === "READY") {
    updates.called_at = new Date().toISOString();
  } else if (nextStatus === "COMPLETED" || nextStatus === "CANCELLED") {
    updates.completed_at = new Date().toISOString();
  }

  const { data, error } = await database.client
    .from("queue_tickets")
    .update(updates)
    .eq("id", ticketId)
    .select("id, organization_id, store_id, order_id, queue_number, status, called_at, completed_at, created_at")
    .single();

  if (error) {
    throwDatabaseError(error, "queue ticket update");
    throw new QueueError("QUEUE_TICKET_UPDATE_FAILED", error.message);
  }
  if (!data) throw new QueueError("QUEUE_TICKET_UPDATE_FAILED", "Ticket not found");

  return mapQueueTicketRow(data as Row);
}

export async function getQueueDisplaySnapshot(
  database: Database,
  storeCode: string
): Promise<QueueDisplaySnapshot | null> {
  const store = await getStoreByCode(database, storeCode);
  if (!store) return null;

  const today = new Date().toISOString().split("T")[0];

  // Active tickets for today
  const { data, error } = await database.client
    .from("queue_tickets")
    .select("id, organization_id, store_id, order_id, queue_number, status, called_at, completed_at, created_at")
    .eq("store_id", store.id)
    .gte("created_at", `${today}T00:00:00Z`)
    .in("status", ["WAITING", "PREPARING", "READY"])
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    throwDatabaseError(error, "queue display fetch");
    throw new QueueError("QUEUE_DISPLAY_FETCH_FAILED", error.message);
  }

  const tickets = (data || []).map((row) => mapQueueTicketRow(row as Row));

  const preparing = tickets.filter((t) => t.status === "WAITING" || t.status === "PREPARING");
  const ready = tickets.filter((t) => t.status === "READY");

  // Recently called is the latest ticket with called_at
  const sortedReady = [...ready].sort(
    (a, b) => new Date(b.calledAt ?? b.createdAt).getTime() - new Date(a.calledAt ?? a.createdAt).getTime()
  );
  const recentlyCalled: QueueTicketSummary | null = sortedReady.length > 0 ? (sortedReady[0] as QueueTicketSummary) : null;

  return {
    store: {
      id: store.id,
      code: store.code,
      name: store.name
    },
    preparing,
    ready,
    recentlyCalled
  };
}

function mapQueueTicketRow(row: Row, orderNumber?: string): QueueTicketSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    orderId: String(row.order_id),
    ...(orderNumber ? { orderNumber } : {}),
    queueNumber: String(row.queue_number),
    status: row.status as QueueTicketStatus,
    calledAt: row.called_at ? String(row.called_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at)
  };
}

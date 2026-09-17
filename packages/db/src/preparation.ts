import type {
  OrderReadinessResult,
  PreparationStationStatus,
  PreparationStationSummary,
  PreparationTaskStatus,
  PreparationTaskSummary,
  StationMatchRuleType,
  StationRoutingRuleSummary
} from "@aevo/contracts";
import type { Database } from "./client";

export class PreparationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PreparationError";
  }
}

type Row = Record<string, unknown>;

function mapStationRow(row: Row): PreparationStationSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    code: String(row.code),
    name: String(row.name),
    displayOrder: typeof row.display_order === "number" ? row.display_order : 0,
    status: (row.status as PreparationStationStatus) || "ACTIVE"
  };
}

function mapRuleRow(row: Row): StationRoutingRuleSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    stationId: String(row.station_id),
    matchType: (row.match_type as StationMatchRuleType) || "ALL",
    ...(row.match_id ? { matchId: String(row.match_id) } : {}),
    priority: typeof row.priority === "number" ? row.priority : 0
  };
}

export async function listPreparationStations(
  database: Database,
  storeId: string
): Promise<PreparationStationSummary[]> {
  const { data, error } = await database.client
    .from("preparation_stations")
    .select("id, organization_id, store_id, code, name, display_order, status")
    .eq("store_id", storeId)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new PreparationError("STATION_LIST_FAILED", error.message);
  }

  return (data ?? []).map((row) => mapStationRow(row as Row));
}

export async function getOrCreateDefaultStation(
  database: Database,
  organizationId: string,
  storeId: string
): Promise<PreparationStationSummary> {
  const { data, error } = await database.client
    .from("preparation_stations")
    .select("id, organization_id, store_id, code, name, display_order, status")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new PreparationError("STATION_QUERY_FAILED", error.message);
  }

  if (data) {
    return mapStationRow(data as Row);
  }

  // Create default KITCHEN station
  const defaultStation = {
    organization_id: organizationId,
    store_id: storeId,
    code: "MAIN",
    name: "Main Kitchen",
    display_order: 1,
    status: "ACTIVE"
  };

  const { data: inserted, error: insertError } = await database.client
    .from("preparation_stations")
    .insert(defaultStation)
    .select("id, organization_id, store_id, code, name, display_order, status")
    .single();

  if (insertError) {
    // If concurrent insert occurred, fetch it
    const { data: fallback } = await database.client
      .from("preparation_stations")
      .select("id, organization_id, store_id, code, name, display_order, status")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .limit(1)
      .single();

    if (fallback) return mapStationRow(fallback as Row);
    throw new PreparationError("STATION_CREATE_FAILED", insertError.message);
  }

  return mapStationRow(inserted as Row);
}

export async function createPreparationStation(
  database: Database,
  params: {
    organizationId: string;
    storeId: string;
    code: string;
    name: string;
    displayOrder?: number;
    status?: PreparationStationStatus;
  }
): Promise<PreparationStationSummary> {
  const payload: Record<string, unknown> = {
    organization_id: params.organizationId,
    store_id: params.storeId,
    code: params.code.trim().toUpperCase(),
    name: params.name.trim(),
    display_order: params.displayOrder ?? 0,
    status: params.status ?? "ACTIVE"
  };

  const { data, error } = await database.client
    .from("preparation_stations")
    .insert(payload)
    .select("id, organization_id, store_id, code, name, display_order, status")
    .single();

  if (error) {
    throw new PreparationError("STATION_CREATE_FAILED", error.message);
  }

  return mapStationRow(data as Row);
}

export async function createStationRoutingRule(
  database: Database,
  params: {
    organizationId: string;
    storeId: string;
    stationId: string;
    matchType: StationMatchRuleType;
    matchId?: string | null;
    priority?: number;
  }
): Promise<StationRoutingRuleSummary> {
  const payload: Record<string, unknown> = {
    organization_id: params.organizationId,
    store_id: params.storeId,
    station_id: params.stationId,
    match_type: params.matchType,
    match_id: params.matchId ?? null,
    priority: params.priority ?? 0
  };

  const { data, error } = await database.client
    .from("station_routing_rules")
    .insert(payload)
    .select("id, organization_id, store_id, station_id, match_type, match_id, priority")
    .single();

  if (error) {
    throw new PreparationError("ROUTING_RULE_CREATE_FAILED", error.message);
  }

  return mapRuleRow(data as Row);
}

export async function listStationRoutingRules(
  database: Database,
  storeId: string
): Promise<StationRoutingRuleSummary[]> {
  const { data, error } = await database.client
    .from("station_routing_rules")
    .select("id, organization_id, store_id, station_id, match_type, match_id, priority")
    .eq("store_id", storeId)
    .order("priority", { ascending: false });

  if (error) {
    throw new PreparationError("ROUTING_RULES_LIST_FAILED", error.message);
  }

  return (data ?? []).map((row) => mapRuleRow(row as Row));
}

export async function routeOrderToStations(
  database: Database,
  params: {
    organizationId: string;
    storeId: string;
    orderId: string;
  }
): Promise<PreparationTaskSummary[]> {
  // Check if tasks already exist for this order
  const existingTasks = await listPreparationTasks(database, {
    storeId: params.storeId,
    status: ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]
  });
  const orderTasks = existingTasks.filter((t) => t.orderId === params.orderId);
  if (orderTasks.length > 0) {
    return orderTasks;
  }

  // Fetch order items with order and queue info
  const { data: orderItems, error: itemsError } = await database.client
    .from("order_items")
    .select("id, product_id, product_name, variant_name, quantity, note")
    .eq("organization_id", params.organizationId)
    .eq("order_id", params.orderId);

  if (itemsError || !orderItems || orderItems.length === 0) {
    return [];
  }

  // Fetch routing rules and stations
  const rules = await listStationRoutingRules(database, params.storeId);
  const defaultStation = await getOrCreateDefaultStation(database, params.organizationId, params.storeId);

  const tasksToInsert: Array<Record<string, unknown>> = [];

  for (const item of orderItems) {
    let targetStationId = defaultStation.id;

    // Evaluate rules by priority
    for (const rule of rules) {
      if (rule.matchType === "PRODUCT" && rule.matchId === item.product_id) {
        targetStationId = rule.stationId;
        break;
      }
      if (rule.matchType === "ALL") {
        targetStationId = rule.stationId;
        break;
      }
    }

    tasksToInsert.push({
      organization_id: params.organizationId,
      store_id: params.storeId,
      order_id: params.orderId,
      order_item_id: item.id,
      station_id: targetStationId,
      status: "PENDING"
    });
  }

  if (tasksToInsert.length > 0) {
    const { error: insertError } = await database.client
      .from("preparation_tasks")
      .insert(tasksToInsert);

    if (insertError) {
      throw new PreparationError("PREPARATION_TASKS_INSERT_FAILED", insertError.message);
    }
  }

  return listPreparationTasks(database, {
    storeId: params.storeId,
    status: ["PENDING", "IN_PROGRESS"]
  }).then((tasks) => tasks.filter((t) => t.orderId === params.orderId));
}

export async function listPreparationTasks(
  database: Database,
  params: {
    storeId: string;
    stationId?: string;
    status?: PreparationTaskStatus | PreparationTaskStatus[];
  }
): Promise<PreparationTaskSummary[]> {
  let query = database.client
    .from("preparation_tasks")
    .select(`
      id,
      organization_id,
      store_id,
      order_id,
      order_item_id,
      station_id,
      status,
      started_at,
      completed_at,
      created_at,
      orders:order_id(order_number),
      preparation_stations:station_id(code, name),
      order_items:order_item_id(
        product_name,
        variant_name,
        quantity,
        note,
        order_item_modifiers(modifier_name)
      )
    `)
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: true });

  if (params.stationId) {
    query = query.eq("station_id", params.stationId);
  }

  if (params.status) {
    if (Array.isArray(params.status)) {
      query = query.in("status", params.status);
    } else {
      query = query.eq("status", params.status);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new PreparationError("PREPARATION_TASKS_LIST_FAILED", error.message);
  }

  // Get queue tickets for these orders
  const orderIds = Array.from(new Set((data ?? []).map((row: Row) => String(row.order_id))));
  const queueMap = new Map<string, string>();

  if (orderIds.length > 0) {
    const { data: queueRows } = await database.client
      .from("queue_tickets")
      .select("order_id, queue_number")
      .in("order_id", orderIds);

    for (const q of queueRows ?? []) {
      queueMap.set(String(q.order_id), String(q.queue_number));
    }
  }

  return (data ?? []).map((row: Row) => {
    const orderData = (row.orders as Row) ?? {};
    const stationData = (row.preparation_stations as Row) ?? {};
    const itemData = (row.order_items as Row) ?? {};
    const modifiersRaw = (itemData.order_item_modifiers as Row[]) ?? [];

    const orderId = String(row.order_id);
    const queueNum = queueMap.get(orderId);

    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      storeId: String(row.store_id),
      orderId,
      orderNumber: String(orderData.order_number ?? "UNKNOWN"),
      ...(queueNum ? { queueNumber: queueNum } : {}),
      orderItemId: String(row.order_item_id),
      productName: String(itemData.product_name ?? "Product"),
      ...(itemData.variant_name ? { variantName: String(itemData.variant_name) } : {}),
      quantity: typeof itemData.quantity === "number" ? itemData.quantity : 1,
      modifiers: modifiersRaw.map((m) => ({ name: String(m.modifier_name ?? "") })),
      ...(itemData.note ? { note: String(itemData.note) } : {}),
      stationId: String(row.station_id),
      stationName: String(stationData.name ?? "Station"),
      stationCode: String(stationData.code ?? "MAIN"),
      status: (row.status as PreparationTaskStatus) || "PENDING",
      ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
      ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
      createdAt: String(row.created_at)
    };
  });
}

export async function completePreparationTask(
  database: Database,
  params: {
    taskId: string;
    completedBy?: string;
  }
): Promise<PreparationTaskSummary> {
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: "DONE",
    completed_at: now
  };
  if (params.completedBy) {
    updatePayload.completed_by = params.completedBy;
  }

  const { data: updated, error } = await database.client
    .from("preparation_tasks")
    .update(updatePayload)
    .eq("id", params.taskId)
    .select("id, organization_id, store_id, order_id, order_item_id, station_id, status, started_at, completed_at, created_at")
    .single();

  if (error || !updated) {
    throw new PreparationError("TASK_COMPLETE_FAILED", error?.message ?? "Task not found");
  }

  const tasks = await listPreparationTasks(database, {
    storeId: updated.store_id,
    status: ["PENDING", "IN_PROGRESS", "DONE"]
  });

  const found = tasks.find((t) => t.id === params.taskId);
  if (!found) {
    throw new PreparationError("TASK_NOT_FOUND", "Task not found after update");
  }

  return found;
}

export async function checkOrderReadiness(
  database: Database,
  orderId: string
): Promise<OrderReadinessResult> {
  const { data, error } = await database.client
    .from("preparation_tasks")
    .select("status")
    .eq("order_id", orderId);

  if (error || !data || data.length === 0) {
    return "STILL_PREPARING";
  }

  const allDone = data.every((row: Row) => row.status === "DONE" || row.status === "CANCELLED");
  if (allDone) {
    return "READY";
  }

  const anyDone = data.some((row: Row) => row.status === "DONE");
  if (anyDone) {
    return "PARTIALLY_READY";
  }

  return "STILL_PREPARING";
}

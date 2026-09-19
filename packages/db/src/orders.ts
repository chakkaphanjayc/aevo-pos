import type {
  CreateOrderInput,
  CreatePublicOrderInput,
  FulfillmentType,
  OrderChannel,
  OrderListItem,
  OrderStatus,
  OrderSummary,
  OrderType,
  PaymentMethod,
  RecordPaymentInput,
  SessionPrincipal,
  TransitionOrderInput
} from "@aevo/contracts";
import { fulfillmentTypes, orderChannels, orderStatuses, orderTypes, paymentMethods } from "@aevo/contracts";
import { assertOrderTransition } from "@aevo/ordering";
import { getStoreByCode } from "./catalog";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

export class OrderValidationError extends Error {
  readonly code = "ORDER_VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}

export class OrderConflictError extends Error {
  readonly code = "ORDER_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "OrderConflictError";
  }
}

export class OrderNotFoundError extends Error {
  readonly code = "ORDER_NOT_FOUND";
  constructor(message = "Order was not found") {
    super(message);
    this.name = "OrderNotFoundError";
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isOrderChannel(value: string): value is OrderChannel {
  return orderChannels.includes(value as OrderChannel);
}

function isFulfillmentType(value: string): value is FulfillmentType {
  return fulfillmentTypes.includes(value as FulfillmentType);
}

function isOrderStatus(value: string): value is OrderStatus {
  return orderStatuses.includes(value as OrderStatus);
}

function isPaymentMethod(value: string): value is PaymentMethod {
  return paymentMethods.includes(value as PaymentMethod);
}

function mapModifier(row: Row) {
  return {
    id: String(row.id),
    modifierId: String(row.modifier_id),
    modifierGroupId: String(row.modifier_group_id),
    name: String(row.name),
    priceDeltaMinor: Number(row.price_delta_minor ?? 0),
    quantity: Number(row.quantity ?? 1)
  };
}

function mapItem(row: Row, modifiers: ReturnType<typeof mapModifier>[]) {
  return {
    id: String(row.id),
    lineNumber: Number(row.line_number),
    productId: String(row.product_id),
    ...(optionalString(row.variant_id) ? { variantId: String(row.variant_id) } : {}),
    ...(optionalString(row.menu_item_id) ? { menuItemId: String(row.menu_item_id) } : {}),
    sku: String(row.sku),
    productName: String(row.product_name),
    ...(optionalString(row.variant_name) ? { variantName: String(row.variant_name) } : {}),
    unitPriceMinor: Number(row.unit_price_minor ?? 0),
    quantity: Number(row.quantity ?? 0),
    subtotalMinor: Number(row.subtotal_minor ?? 0),
    ...(optionalString(row.note) ? { note: String(row.note) } : {}),
    modifiers
  };
}

function mapOrder(row: Row, items: ReturnType<typeof mapItem>[]): OrderSummary {
  const channel = String(row.channel);
  const fulfillmentType = String(row.fulfillment_type);
  const status = String(row.status);
  const paymentStatus = String(row.payment_status);
  if (!isOrderChannel(channel) || !isFulfillmentType(fulfillmentType) || !isOrderStatus(status)) {
    throw new Error("Supabase returned an invalid order enum");
  }
  const orderType: OrderType = (row.order_type && orderTypes.includes(row.order_type as OrderType))
    ? (row.order_type as OrderType)
    : (channel === "KIOSK" ? "KIOSK" : channel === "QR" ? "QR_ORDER" : "POS");
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    orderNumber: String(row.order_number),
    channel,
    orderType,
    fulfillmentType,
    status,
    paymentStatus: paymentStatus as OrderSummary["paymentStatus"],
    currency: String(row.currency),
    subtotalMinor: Number(row.subtotal_minor ?? 0),
    discountMinor: Number(row.discount_minor ?? 0),
    taxMinor: Number(row.tax_minor ?? 0),
    totalMinor: Number(row.total_minor ?? 0),
    ...(optionalString(row.customer_name) ? { customerName: String(row.customer_name) } : {}),
    ...(optionalString(row.customer_phone) ? { customerPhone: String(row.customer_phone) } : {}),
    ...(optionalString(row.customer_email) ? { customerEmail: String(row.customer_email) } : {}),
    ...(optionalString(row.notes) ? { notes: String(row.notes) } : {}),
    ...(optionalString(row.scheduled_pickup_at) ? { scheduledPickupAt: String(row.scheduled_pickup_at) } : {}),
    ...(optionalString(row.prepare_at) ? { prepareAt: String(row.prepare_at) } : {}),
    items,
    ...(optionalString(row.created_by) ? { createdBy: String(row.created_by) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(optionalString(row.public_tracking_token) ? { publicTrackingToken: String(row.public_tracking_token) } : {})
  };
}

function mapListOrder(row: Row, itemCount: number): OrderListItem {
  const channel = String(row.channel);
  const fulfillmentType = String(row.fulfillment_type);
  const status = String(row.status);
  const paymentStatus = String(row.payment_status);
  if (!isOrderChannel(channel) || !isFulfillmentType(fulfillmentType) || !isOrderStatus(status)) {
    throw new Error("Supabase returned an invalid order enum");
  }
  const orderType: OrderType = (row.order_type && orderTypes.includes(row.order_type as OrderType))
    ? (row.order_type as OrderType)
    : (channel === "KIOSK" ? "KIOSK" : channel === "QR" ? "QR_ORDER" : "POS");
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    orderNumber: String(row.order_number),
    channel,
    orderType,
    fulfillmentType,
    status,
    paymentStatus: paymentStatus as OrderListItem["paymentStatus"],
    currency: String(row.currency),
    totalMinor: Number(row.total_minor ?? 0),
    itemCount,
    ...(optionalString(row.scheduled_pickup_at) ? { scheduledPickupAt: String(row.scheduled_pickup_at) } : {}),
    ...(optionalString(row.prepare_at) ? { prepareAt: String(row.prepare_at) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function firstRow(data: unknown): Row | undefined {
  if (Array.isArray(data)) return data[0] as Row | undefined;
  return data && typeof data === "object" ? data as Row : undefined;
}

function throwOrderError(error: { message: string; code?: string } | null, operation: string): void {
  if (!error) return;
  const message = error.message || `Supabase ${operation} failed`;
  if (error.code === "40001" || error.code === "23505") throw new OrderConflictError(message);
  if (error.code === "P0002") throw new OrderNotFoundError(message);
  if (error.code === "22023" || error.code === "23503" || error.code === "22P02") throw new OrderValidationError(message);
  throwDatabaseError(error, operation);
}

function normalizeCreateInput(input: CreateOrderInput): CreateOrderInput {
  if (!isOrderChannel(input.channel)) throw new OrderValidationError("Unsupported order channel");
  if (!isFulfillmentType(input.fulfillmentType)) throw new OrderValidationError("Unsupported fulfillment type");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new OrderValidationError("An order must contain between 1 and 100 items");
  }
  const currency = input.currency?.trim().toUpperCase();
  const customerName = input.customerName?.trim();
  const customerPhone = input.customerPhone?.trim();
  const customerEmail = input.customerEmail?.trim().toLowerCase();
  const notes = input.notes?.trim();
  return {
    storeId: input.storeId,
    channel: input.channel,
    fulfillmentType: input.fulfillmentType,
    ...(currency ? { currency } : {}),
    ...(customerName ? { customerName } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(notes ? { notes } : {}),
    ...(input.scheduledPickupAt ? { scheduledPickupAt: input.scheduledPickupAt } : {}),
    ...(input.prepareAt ? { prepareAt: input.prepareAt } : {}),
    items: input.items.map((item) => {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
        throw new OrderValidationError("Each order item needs a valid productId and quantity");
      }
      return {
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        ...(item.menuItemId ? { menuItemId: item.menuItemId } : {}),
        ...(item.modifierIds?.length ? { modifierIds: [...item.modifierIds] } : {}),
        quantity: item.quantity,
        ...(item.note?.trim() ? { note: item.note.trim() } : {})
      };
    })
  };
}

const orderSelect = "id,organization_id,store_id,order_number,channel,fulfillment_type,status,payment_status,currency,subtotal_minor,discount_minor,tax_minor,total_minor,customer_name,customer_phone,customer_email,notes,created_by,created_at,updated_at,scheduled_pickup_at,prepare_at,public_tracking_token,order_type";
const itemSelect = "id,organization_id,order_id,line_number,product_id,variant_id,menu_item_id,sku,product_name,product_description,variant_code,variant_name,unit_price_minor,quantity,subtotal_minor,note";
const modifierSelect = "id,organization_id,order_item_id,modifier_id,modifier_group_id,name,price_delta_minor,quantity";

export async function getOrder(database: Database, principal: SessionPrincipal, storeId: string, orderId: string): Promise<OrderSummary> {
  const orderResult = await database.client
    .from("orders")
    .select(orderSelect)
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .eq("id", orderId)
    .maybeSingle();
  throwOrderError(orderResult.error, "order lookup");
  if (!orderResult.data) throw new OrderNotFoundError("Order was not found in the selected store");
  const itemsResult = await database.client.from("order_items").select(itemSelect)
    .eq("organization_id", principal.organizationId).eq("order_id", orderId)
    .order("line_number", { ascending: true });
  throwOrderError(itemsResult.error, "order items lookup");
  const itemRows = (itemsResult.data ?? []) as Row[];
  const itemIds = itemRows.map((item) => String(item.id));
  let modifierRows: Row[] = [];
  if (itemIds.length > 0) {
    const modifiersResult = await database.client.from("order_item_modifiers").select(modifierSelect)
      .eq("organization_id", principal.organizationId)
      .in("order_item_id", itemIds);
    throwOrderError(modifiersResult.error, "order modifiers lookup");
    modifierRows = (modifiersResult.data ?? []) as Row[];
  }
  const modifiersByItem = new Map<string, ReturnType<typeof mapModifier>[]>();
  for (const row of modifierRows) {
    const values = modifiersByItem.get(String(row.order_item_id)) ?? [];
    values.push(mapModifier(row));
    modifiersByItem.set(String(row.order_item_id), values);
  }
  return mapOrder(orderResult.data as Row, itemRows.map((row) => mapItem(row, modifiersByItem.get(String(row.id)) ?? [])));
}

export async function listOrders(
  database: Database,
  principal: SessionPrincipal,
  storeId: string,
  options: { status?: OrderStatus; limit?: number } = {}
): Promise<OrderListItem[]> {
  if (options.status && !isOrderStatus(options.status)) throw new OrderValidationError("Unsupported order status");
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  let query = database.client.from("orders").select(orderSelect)
    .eq("organization_id", principal.organizationId).eq("store_id", storeId)
    .order("created_at", { ascending: false }).limit(limit);
  if (options.status) query = query.eq("status", options.status);
  const ordersResult = await query;
  throwOrderError(ordersResult.error, "order list");
  const rows = (ordersResult.data ?? []) as Row[];
  const orderIds = rows.map((row) => String(row.id));
  const itemsResult = orderIds.length > 0
    ? await database.client.from("order_items").select("order_id")
      .eq("organization_id", principal.organizationId)
      .in("order_id", orderIds)
    : { data: [], error: null };
  throwOrderError(itemsResult.error, "order item count");
  const counts = new Map<string, number>();
  for (const row of (itemsResult.data ?? []) as Row[]) {
    const id = String(row.order_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return rows.map((row) => mapListOrder(row, counts.get(String(row.id)) ?? 0));
}

export async function createOrder(
  database: Database,
  principal: SessionPrincipal,
  input: CreateOrderInput,
  idempotencyKey: string
): Promise<OrderSummary> {
  const normalized = normalizeCreateInput(input);
  if (!idempotencyKey?.trim()) throw new OrderValidationError("Idempotency-Key is required for order creation");
  const result = await database.client.rpc("create_order", {
    p_organization_id: principal.organizationId,
    p_store_id: normalized.storeId,
    p_created_by: (principal.userId && principal.userId.length > 0) ? principal.userId : null,
    p_channel: normalized.channel,
    p_fulfillment_type: normalized.fulfillmentType,
    p_currency: normalized.currency ?? null,
    p_customer_name: normalized.customerName ?? null,
    p_customer_phone: normalized.customerPhone ?? null,
    p_customer_email: normalized.customerEmail ?? null,
    p_notes: normalized.notes ?? null,
    p_items: normalized.items,
    p_idempotency_key: idempotencyKey.trim()
  });
  throwOrderError(result.error, "order creation");
  const row = firstRow(result.data);
  if (!row?.order_id) throw new Error("Supabase order creation returned no order");
  const orderId = String(row.order_id);

  if (normalized.scheduledPickupAt) {
    const pickupDate = new Date(normalized.scheduledPickupAt);
    const prepMinutes = 15;
    const prepareAt = new Date(pickupDate.getTime() - prepMinutes * 60 * 1000).toISOString();
    const pickupUpdate = await database.client.from("orders").update({
      scheduled_pickup_at: pickupDate.toISOString(),
      prepare_at: prepareAt
    }).eq("organization_id", principal.organizationId).eq("store_id", normalized.storeId).eq("id", orderId);
    throwOrderError(pickupUpdate.error, "scheduled pickup update");
  }

  return getOrder(database, principal, normalized.storeId, orderId);
}

export async function createPublicOrder(
  database: Database,
  input: CreatePublicOrderInput,
  idempotencyKey: string
): Promise<OrderSummary> {
  const store = await getStoreByCode(database, input.storeCode);
  if (!store || store.status !== "ACTIVE") {
    throw new OrderValidationError(`Store "${input.storeCode}" was not found or is inactive`);
  }

  const tablePrefix = input.tableNumber ? `[โต๊ะ ${input.tableNumber.trim()}] ` : "";
  const combinedNotes = (tablePrefix + (input.notes?.trim() ?? "")).trim() || undefined;

  const orderInput: CreateOrderInput = {
    storeId: store.id,
    channel: input.channel || "QR",
    fulfillmentType: input.fulfillmentType,
    ...(input.customerName ? { customerName: input.customerName.trim() } : {}),
    ...(input.customerPhone ? { customerPhone: input.customerPhone.trim() } : {}),
    ...(combinedNotes ? { notes: combinedNotes } : {}),
    ...(input.scheduledPickupAt ? { scheduledPickupAt: input.scheduledPickupAt } : {}),
    items: input.items
  };

  const anonymousPrincipal: SessionPrincipal = {
    userId: "",
    email: "anonymous@customer",
    organizationId: store.organizationId,
    membershipId: "",
    role: "VIEWER",
    permissions: []
  };

  return createOrder(database, anonymousPrincipal, orderInput, idempotencyKey);
}

/**
 * Resolve a customer order using the opaque token issued by the database.
 * This deliberately returns the normal aggregate so the API can apply a
 * public projection without exposing organization/store internals.
 */
export async function getPublicOrderByToken(
  database: Database,
  storeCode: string,
  token: string
): Promise<OrderSummary | null> {
  const store = await getStoreByCode(database, storeCode);
  if (!store || store.status !== "ACTIVE" || !/^[a-f0-9]{32,128}$/i.test(token)) return null;

  const result = await database.client
    .from("orders")
    .select("id")
    .eq("organization_id", store.organizationId)
    .eq("store_id", store.id)
    .eq("public_tracking_token", token)
    .maybeSingle();
  throwDatabaseError(result.error, "public order lookup");
  if (!result.data) return null;

  const anonymousPrincipal: SessionPrincipal = {
    userId: "",
    email: "anonymous@customer",
    organizationId: store.organizationId,
    membershipId: "",
    role: "VIEWER",
    permissions: []
  };
  return getOrder(database, anonymousPrincipal, store.id, String((result.data as Row).id));
}

export async function transitionOrder(
  database: Database,
  principal: SessionPrincipal,
  orderId: string,
  input: TransitionOrderInput,
  idempotencyKey: string
): Promise<OrderSummary> {
  if (!isOrderStatus(input.toStatus)) throw new OrderValidationError("Unsupported order status");
  if (input.expectedStatus && !isOrderStatus(input.expectedStatus)) throw new OrderValidationError("Unsupported expected order status");
  if (!idempotencyKey?.trim()) throw new OrderValidationError("Idempotency-Key is required for order transitions");
  if (input.expectedStatus) {
    // This is an early client-side guard. The database function repeats the
    // check under a row lock to protect against concurrent staff actions.
    assertOrderTransition(input.expectedStatus, input.toStatus);
  }
  const result = await database.client.rpc("transition_order", {
    p_organization_id: principal.organizationId,
    p_store_id: input.storeId,
    p_order_id: orderId,
    p_actor_id: principal.userId,
    p_to_status: input.toStatus,
    p_expected_status: input.expectedStatus ?? null,
    p_reason: input.reason?.trim() || null,
    p_idempotency_key: idempotencyKey.trim()
  });
  throwOrderError(result.error, "order transition");
  const row = firstRow(result.data);
  if (!row?.order_id) throw new Error("Supabase order transition returned no order");
  return getOrder(database, principal, input.storeId, orderId);
}

export async function recordOrderPayment(
  database: Database,
  principal: SessionPrincipal,
  orderId: string,
  input: RecordPaymentInput,
  idempotencyKey: string
): Promise<OrderSummary> {
  if (!isPaymentMethod(input.method)) throw new OrderValidationError("Unsupported payment method");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new OrderValidationError("Payment amount must be positive");
  if (!idempotencyKey?.trim()) throw new OrderValidationError("Idempotency-Key is required for payments");

  const result = await database.client.rpc("record_order_payment", {
    p_organization_id: principal.organizationId,
    p_store_id: input.storeId,
    p_order_id: orderId,
    p_received_by: principal.userId,
    p_method: input.method,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency?.trim().toUpperCase() || null,
    p_provider_reference: input.providerReference?.trim() || null,
    p_idempotency_key: idempotencyKey.trim()
  });
  throwOrderError(result.error, "payment recording");
  const row = firstRow(result.data);
  if (!row?.order_id) throw new Error("Supabase payment recording returned no order");
  return getOrder(database, principal, input.storeId, orderId);
}

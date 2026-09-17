import type { OrderStatus, OrderSummary } from "@aevo/contracts";

export type RealtimeEventName =
  | "order.created"
  | "order.status"
  | "order.payment"
  | "catalog.updated"
  | "queue.ticket"
  | "preparation.task";

export interface OrderCreatedPayload {
  order: OrderSummary;
}

export interface OrderStatusPayload {
  orderId: string;
  orderNumber: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  occurredAt: string;
}

export interface OrderPaymentPayload {
  orderId: string;
  paymentMethod: string;
  amountMinor: number;
  occurredAt: string;
}

export interface CatalogUpdatedPayload {
  storeId: string;
  timestamp: number;
}

export interface QueueTicketPayload {
  ticketId: string;
  queueNumber: string;
  status: string;
  occurredAt: string;
}

export interface PreparationTaskPayload {
  taskId: string;
  orderId: string;
  stationId: string;
  status: string;
  occurredAt: string;
}

export type RealtimePayloadMap = {
  "order.created": OrderCreatedPayload;
  "order.status": OrderStatusPayload;
  "order.payment": OrderPaymentPayload;
  "catalog.updated": CatalogUpdatedPayload;
  "queue.ticket": QueueTicketPayload;
  "preparation.task": PreparationTaskPayload;
};

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEventName;
  storeId: string;
  payload: T;
  timestamp: number;
}

export function formatStoreChannel(storeId: string): string {
  return `store:${storeId}`;
}

export function parseStoreChannel(channelName: string): string | null {
  if (channelName.startsWith("store:")) {
    return channelName.slice(6);
  }
  return null;
}

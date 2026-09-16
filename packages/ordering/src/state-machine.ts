import type { OrderStatus } from "@aevo/contracts";

const transitionMap: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "PAID", "CANCELLED"],
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["CONFIRMED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"],
  CONFIRMED: ["QUEUED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"],
  QUEUED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["PARTIALLY_READY", "READY", "CANCELLED"],
  PARTIALLY_READY: ["READY", "CANCELLED"],
  READY: ["SERVED", "PICKED_UP", "CANCELLED"],
  SERVED: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"],
  PICKED_UP: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"],
  COMPLETED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  NO_SHOW: ["CANCELLED"]
};

const eventMap: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "order.payment_pending",
  PAID: "order.paid",
  CONFIRMED: "order.confirmed",
  QUEUED: "order.queued",
  ACCEPTED: "order.accepted",
  PREPARING: "order.preparing",
  PARTIALLY_READY: "order.partially_ready",
  READY: "order.ready",
  SERVED: "order.served",
  PICKED_UP: "order.picked_up",
  COMPLETED: "order.completed",
  CANCELLED: "order.cancelled",
  REFUNDED: "order.refunded",
  PARTIALLY_REFUNDED: "order.partially_refunded",
  NO_SHOW: "order.no_show"
};

export class InvalidOrderTransitionError extends Error {
  readonly code = "INVALID_ORDER_TRANSITION";
  constructor(readonly from: OrderStatus, readonly to: OrderStatus) {
    super(`Order cannot transition from ${from} to ${to}`);
    this.name = "InvalidOrderTransitionError";
  }
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return transitionMap[from]?.includes(to) ?? false;
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) throw new InvalidOrderTransitionError(from, to);
}

export function allowedOrderTransitions(from: OrderStatus): readonly OrderStatus[] {
  return transitionMap[from] ?? [];
}

export function eventTypeForOrderStatus(status: OrderStatus): string | undefined {
  return eventMap[status];
}

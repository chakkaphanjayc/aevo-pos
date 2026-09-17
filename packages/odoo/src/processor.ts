import type { OrderSummary } from "@aevo/contracts";
import { OdooClient, type OdooConfig } from "./client";
import { mapOrderToOdooSaleOrder } from "./mapper";

export interface DomainOutboxEvent {
  id: string;
  eventType: string;
  payload: unknown;
  retryCount: number;
}

export interface ProcessResult {
  processedEventIds: string[];
  failedEventIds: string[];
  deadLetteredIds: string[];
}

export async function processOutboxToOdoo(
  events: DomainOutboxEvent[],
  config: OdooConfig,
  client: OdooClient = new OdooClient(config)
): Promise<ProcessResult> {
  const processedEventIds: string[] = [];
  const failedEventIds: string[] = [];
  const deadLetteredIds: string[] = [];

  for (const ev of events) {
    if (ev.eventType !== "order.completed" && ev.eventType !== "order.paid") {
      continue;
    }

    try {
      const order = (ev.payload as { order: OrderSummary })?.order;
      if (!order) {
        throw new Error("Missing order payload in domain event");
      }

      const saleOrder = mapOrderToOdooSaleOrder(order, config);
      await client.callKw("sale.order", "create", [saleOrder]);
      processedEventIds.push(ev.id);
    } catch {
      if (ev.retryCount >= 5) {
        deadLetteredIds.push(ev.id);
      } else {
        failedEventIds.push(ev.id);
      }
    }
  }

  return {
    processedEventIds,
    failedEventIds,
    deadLetteredIds
  };
}

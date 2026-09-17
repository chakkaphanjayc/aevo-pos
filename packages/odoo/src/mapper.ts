import type { OrderSummary } from "@aevo/contracts";
import type { OdooConfig } from "./client";

export interface OdooOrderLine {
  name: string;
  price_unit: number;
  product_uom_qty: number;
}

export interface OdooSaleOrder {
  partner_id: number;
  client_order_ref: string;
  note: string;
  order_line: Array<[number, number, OdooOrderLine]>;
}

export function mapOrderToOdooSaleOrder(
  order: OrderSummary,
  config: OdooConfig
): OdooSaleOrder {
  const partnerId = config.defaultPartnerId || 1;

  const orderLines: Array<[number, number, OdooOrderLine]> = order.items.map((item) => {
    const unitPrice = item.unitPriceMinor / 100;
    const modifierText =
      item.modifiers && item.modifiers.length > 0
        ? ` (${item.modifiers.map((m) => m.name).join(", ")})`
        : "";
    const description = `${item.productName}${item.variantName ? ` - ${item.variantName}` : ""}${modifierText}`;

    return [
      0,
      0,
      {
        name: description,
        price_unit: unitPrice,
        product_uom_qty: item.quantity
      }
    ];
  });

  return {
    partner_id: partnerId,
    client_order_ref: order.orderNumber,
    note: `Aevo POS Order: ${order.orderNumber} (Channel: ${order.channel})`,
    order_line: orderLines
  };
}

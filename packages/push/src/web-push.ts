export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export function buildNotificationPayload(
  title: string,
  body: string,
  options: {
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
  } = {}
): PushNotificationPayload {
  return {
    title,
    body,
    ...(options.icon ? { icon: options.icon } : {}),
    ...(options.badge ? { badge: options.badge } : {}),
    ...(options.tag ? { tag: options.tag } : {}),
    ...(options.data ? { data: options.data } : {})
  };
}

export function createOrderReadyNotification(
  orderNumber: string,
  queueNumber?: string
): PushNotificationPayload {
  const queuePart = queueNumber ? ` [คิว ${queueNumber}]` : "";
  return buildNotificationPayload(
    `ออเดอร์พร้อมรับแล้ว!${queuePart}`,
    `ออเดอร์ ${orderNumber} พร้อมรับสินค้าที่เคาน์เตอร์แล้วครับ`,
    {
      tag: `order-ready-${orderNumber}`,
      data: {
        orderNumber,
        ...(queueNumber ? { queueNumber } : {}),
        type: "ORDER_READY"
      }
    }
  );
}

export function createOrderConfirmedNotification(
  orderNumber: string,
  queueNumber?: string
): PushNotificationPayload {
  const queuePart = queueNumber ? ` (คิว ${queueNumber})` : "";
  return buildNotificationPayload(
    `รับออเดอร์แล้ว${queuePart}`,
    `ร้านค้าได้รับออเดอร์ ${orderNumber} เรียบร้อยแล้ว กำลังเตรียมให้คุณครับ`,
    {
      tag: `order-confirmed-${orderNumber}`,
      data: {
        orderNumber,
        ...(queueNumber ? { queueNumber } : {}),
        type: "ORDER_CONFIRMED"
      }
    }
  );
}

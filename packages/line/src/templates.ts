/**
 * LINE Flex Message Templates for Order Lifecycle Notifications.
 */

export interface OrderReadyFlexParams {
  storeName: string;
  orderNumber: string;
  queueNumber: string;
  totalFormatted: string;
}

export function buildOrderReadyFlexMessage(params: OrderReadyFlexParams): object {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#238636",
      paddingAll: "20px",
      contents: [
        {
          type: "text",
          text: "🎉 ออเดอร์พร้อมรับแล้ว!",
          weight: "bold",
          color: "#ffffff",
          size: "lg"
        },
        {
          type: "text",
          text: params.storeName,
          color: "#e6ffed",
          size: "sm",
          margin: "xs"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          alignItems: "center",
          backgroundColor: "#f6f8fa",
          paddingAll: "16px",
          cornerRadius: "12px",
          contents: [
            {
              type: "text",
              text: "หมายเลขคิวของคุณ",
              size: "xs",
              color: "#57606a"
            },
            {
              type: "text",
              text: params.queueNumber,
              size: "4xl",
              weight: "bold",
              color: "#0969da"
            },
            {
              type: "text",
              text: `เลขออเดอร์: ${params.orderNumber}`,
              size: "xs",
              color: "#57606a",
              margin: "xs"
            }
          ]
        },
        {
          type: "text",
          text: "กรุณาแสดงหน้าจอนี้เพื่อรับสินค้าที่เคาน์เตอร์ครับ",
          size: "sm",
          color: "#24292f",
          align: "center"
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: `ยอดรวม: ${params.totalFormatted}`,
          weight: "bold",
          size: "sm",
          color: "#24292f",
          align: "center"
        }
      ]
    }
  };
}

export interface OrderConfirmedFlexParams {
  storeName: string;
  orderNumber: string;
  queueNumber?: string;
  itemCount: number;
  totalFormatted: string;
}

export function buildOrderConfirmedFlexMessage(params: OrderConfirmedFlexParams): object {
  const queueLabel = params.queueNumber ? `คิว ${params.queueNumber}` : "ยืนยันแล้ว";
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#0969da",
      paddingAll: "20px",
      contents: [
        {
          type: "text",
          text: `ได้รับออเดอร์แล้ว (${queueLabel})`,
          weight: "bold",
          color: "#ffffff",
          size: "lg"
        },
        {
          type: "text",
          text: params.storeName,
          color: "#ddf4ff",
          size: "sm",
          margin: "xs"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `เลขออเดอร์: ${params.orderNumber}`,
          weight: "bold",
          size: "md"
        },
        {
          type: "text",
          text: `จำนวน: ${params.itemCount} รายการ | ยอดรวม: ${params.totalFormatted}`,
          size: "sm",
          color: "#57606a"
        },
        {
          type: "text",
          text: "ทางร้านกำลังเตรียมออเดอร์ให้คุณ ระบบจะแจ้งเตือนอีกครั้งเมื่อสินค้าพร้อมรับครับ",
          size: "sm",
          color: "#24292f"
        }
      ]
    }
  };
}

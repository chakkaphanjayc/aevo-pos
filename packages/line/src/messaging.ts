/**
 * LINE Messaging API HTTP Client.
 */

export class LineMessagingClient {
  private readonly baseUrl = "https://api.line.me/v2/bot";

  constructor(private readonly channelAccessToken: string) {}

  async pushFlexMessage(toUserId: string, altText: string, flexContents: object): Promise<void> {
    const payload = {
      to: toUserId,
      messages: [
        {
          type: "flex",
          altText,
          contents: flexContents
        }
      ]
    };

    const res = await fetch(`${this.baseUrl}/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.channelAccessToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LINE Push Message failed: HTTP ${res.status} - ${errBody}`);
    }
  }

  async replyFlexMessage(replyToken: string, altText: string, flexContents: object): Promise<void> {
    const payload = {
      replyToken,
      messages: [
        {
          type: "flex",
          altText,
          contents: flexContents
        }
      ]
    };

    const res = await fetch(`${this.baseUrl}/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.channelAccessToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LINE Reply Message failed: HTTP ${res.status} - ${errBody}`);
    }
  }
}

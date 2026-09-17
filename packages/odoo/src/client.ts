/**
 * Odoo JSON-RPC Client for sale.order creation and catalog synchronization.
 */

export interface OdooConfig {
  baseUrl: string;
  db: string;
  username: string;
  apiKey: string;
  defaultPartnerId?: number;
}

export interface OdooRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class OdooClient {
  constructor(private readonly config: OdooConfig) {}

  async callKw<T = unknown>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/jsonrpc`;
    const payload = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          this.config.db,
          2, // UID or resolved user ID
          this.config.apiKey,
          model,
          method,
          args,
          kwargs
        ]
      },
      id: Math.floor(Math.random() * 1000000)
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Odoo HTTP error ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const data = (await res.json()) as OdooRpcResponse<T>;
    if (data.error) {
      throw new Error(`Odoo RPC Error: ${data.error.message} (${JSON.stringify(data.error.data)})`);
    }

    return data.result as T;
  }
}

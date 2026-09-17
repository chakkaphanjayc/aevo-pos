import { describe, expect, test } from "bun:test";
import {
  formatQueueNumber,
  getOrCreateQueueConfig,
  createQueueTicket,
  listQueueTickets,
  transitionQueueTicket,
  getQueueDisplaySnapshot,
  type Database
} from "../src";

describe("queue repository", () => {
  test("formats queue number with prefix and zero-padded sequence", () => {
    expect(formatQueueNumber("Q", 1)).toBe("Q-001");
    expect(formatQueueNumber("A", 42)).toBe("A-042");
    expect(formatQueueNumber("VIP", 999)).toBe("VIP-999");
    expect(formatQueueNumber("", 5)).toBe("Q-005");
  });

  test("creates queue ticket and increments sequence", async () => {
    const memory = {
      queue_configs: [] as any[],
      queue_sequences: [] as any[],
      queue_tickets: [] as any[]
    };

    const mockDb: Database = {
      client: {
        from: (table: string) => {
          if (table === "queue_configs") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { organization_id: "org-1", store_id: "store-1", prefix: "Q", reset_daily: true, display_mode: "NUMBER" },
                      error: null
                    })
                  })
                })
              })
            };
          }
          if (table === "queue_sequences") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: memory.queue_sequences[0] ?? null,
                        error: null
                      })
                    })
                  })
                })
              }),
              insert: (row: any) => {
                memory.queue_sequences.push(row);
                return Promise.resolve({ data: row, error: null });
              },
              update: (patch: any) => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => {
                      if (memory.queue_sequences[0]) {
                        Object.assign(memory.queue_sequences[0], patch);
                      }
                      return Promise.resolve({ data: memory.queue_sequences[0], error: null });
                    }
                  })
                })
              })
            };
          }
          if (table === "queue_tickets") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: async () => {
                    const found = memory.queue_tickets.find((t) => t[col] === val);
                    return { data: found ?? null, error: null };
                  }
                })
              }),
              insert: (row: any) => ({
                select: () => ({
                  single: async () => {
                    const ticket = {
                      id: "ticket-1",
                      ...row,
                      created_at: new Date().toISOString()
                    };
                    memory.queue_tickets.push(ticket);
                    return { data: ticket, error: null };
                  }
                })
              })
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }
      } as any,
      ping: async () => undefined,
      close: async () => undefined
    };

    const ticket = await createQueueTicket(mockDb, {
      organizationId: "org-1",
      storeId: "store-1",
      orderId: "order-1",
      orderNumber: "SO-20260917-00001",
      prefix: "Q"
    });

    expect(ticket.queueNumber).toBe("Q-001");
    expect(ticket.status).toBe("WAITING");
    expect(ticket.orderNumber).toBe("SO-20260917-00001");
  });

  test("transitions queue ticket status and sets called_at for READY", async () => {
    const ticketRow = {
      id: "ticket-123",
      organization_id: "org-1",
      store_id: "store-1",
      order_id: "order-1",
      queue_number: "Q-005",
      status: "WAITING",
      called_at: null,
      completed_at: null,
      created_at: new Date().toISOString()
    };

    const mockDb: Database = {
      client: {
        from: (table: string) => ({
          update: (patch: any) => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  Object.assign(ticketRow, patch);
                  return { data: ticketRow, error: null };
                }
              })
            })
          })
        })
      } as any,
      ping: async () => undefined,
      close: async () => undefined
    };

    const updated = await transitionQueueTicket(mockDb, "ticket-123", "READY");
    expect(updated.status).toBe("READY");
    expect(updated.calledAt).toBeTruthy();
  });
});

import { describe, expect, it } from "bun:test";
import {
  closeCashSession,
  getCurrentCashSession,
  openCashSession,
  recordCashMovement
} from "../src/cash-sessions";

describe("cash-sessions repository", () => {
  it("computes expected cash and difference on close", async () => {
    let closedSessionData: any = null;

    const mockDb = {
      client: {
        from: (table: string) => {
          if (table === "cash_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({
                      data: {
                        id: "session-1",
                        organization_id: "org-1",
                        store_id: "store-1",
                        opened_by: "user-1",
                        opening_amount_minor: 200000, // 2,000 THB float
                        status: "OPEN",
                        opened_at: "2026-09-17T00:00:00.000Z"
                      },
                      error: null
                    })
                  })
                })
              }),
              update: (updateFields: any) => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => {
                        closedSessionData = updateFields;
                        return {
                          data: {
                            id: "session-1",
                            organization_id: "org-1",
                            store_id: "store-1",
                            opened_by: "user-1",
                            ...updateFields
                          },
                          error: null
                        };
                      }
                    })
                  })
                })
              })
            };
          }
          if (table === "cash_movements") {
            return {
              select: () => ({
                eq: async () => ({
                  data: [
                    {
                      id: "mov-1",
                      movement_type: "PAID_IN",
                      amount_minor: 50000, // +500 THB
                      reason: "Additional change float"
                    },
                    {
                      id: "mov-2",
                      movement_type: "PAID_OUT",
                      amount_minor: 20000, // -200 THB
                      reason: "Bought ice"
                    }
                  ],
                  error: null
                })
              })
            };
          }
          if (table === "payments") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      gte: async () => ({
                        data: [
                          { amount_minor: 150000 } // +1,500 THB cash sales
                        ],
                        error: null
                      })
                    })
                  })
                })
              })
            };
          }
          return {};
        }
      }
    };

    const principal = {
      userId: "user-1",
      email: "cashier@test.com",
      organizationId: "org-1",
      membershipId: "m-1",
      role: "CASHIER" as const,
      permissions: []
    };

    // Expected: 200000 (float) + 150000 (sales) + 50000 (paid in) - 20000 (paid out) = 380000
    // Counted: 385000 (+50 THB over)
    const result = await closeCashSession(mockDb as any, principal, {
      cashSessionId: "session-1",
      storeId: "store-1",
      countedAmountMinor: 385000
    });

    expect(result.status).toBe("CLOSED");
    expect(closedSessionData.expected_amount_minor).toBe(380000);
    expect(closedSessionData.cash_difference_minor).toBe(5000);
  });
});

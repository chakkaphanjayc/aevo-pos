import { describe, expect, it } from "bun:test";
import {
  checkOrderReadiness,
  createPreparationStation,
  createStationRoutingRule,
  listPreparationStations,
  listStationRoutingRules,
  PreparationError
} from "../src/preparation";

describe("preparation repository", () => {
  it("formats and lists preparation stations correctly", async () => {
    const mockDb = {
      client: {
        from: (table: string) => {
          if (table === "preparation_stations") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    order: async () => ({
                      data: [
                        {
                          id: "station-1",
                          organization_id: "org-1",
                          store_id: "store-1",
                          code: "BAR",
                          name: "Beverage Bar",
                          display_order: 1,
                          status: "ACTIVE"
                        },
                        {
                          id: "station-2",
                          organization_id: "org-1",
                          store_id: "store-1",
                          code: "KITCHEN",
                          name: "Main Kitchen",
                          display_order: 2,
                          status: "ACTIVE"
                        }
                      ],
                      error: null
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

    const stations = await listPreparationStations(mockDb as any, "store-1");
    expect(stations).toHaveLength(2);
    expect(stations[0]!.code).toBe("BAR");
    expect(stations[1]!.code).toBe("KITCHEN");
  });

  it("evaluates order readiness accurately", async () => {
    // All done => READY
    const readyDb = {
      client: {
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ status: "DONE" }, { status: "DONE" }],
              error: null
            })
          })
        })
      }
    };
    const readyResult = await checkOrderReadiness(readyDb as any, "order-1");
    expect(readyResult).toBe("READY");

    // Partial done => PARTIALLY_READY
    const partialDb = {
      client: {
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ status: "DONE" }, { status: "PENDING" }],
              error: null
            })
          })
        })
      }
    };
    const partialResult = await checkOrderReadiness(partialDb as any, "order-2");
    expect(partialResult).toBe("PARTIALLY_READY");

    // None done => STILL_PREPARING
    const preparingDb = {
      client: {
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ status: "PENDING" }, { status: "IN_PROGRESS" }],
              error: null
            })
          })
        })
      }
    };
    const preparingResult = await checkOrderReadiness(preparingDb as any, "order-3");
    expect(preparingResult).toBe("STILL_PREPARING");
  });

  it("handles station creation error gracefully", async () => {
    const errorDb = {
      client: {
        from: () => ({
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: { message: "Unique violation on code" }
              })
            })
          })
        })
      }
    };

    await expect(
      createPreparationStation(errorDb as any, {
        organizationId: "org-1",
        storeId: "store-1",
        code: "BAR",
        name: "Bar Station"
      })
    ).rejects.toThrow("Unique violation on code");
  });
});

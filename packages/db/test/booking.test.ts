import { describe, expect, it } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import {
  addToWaitlist,
  checkinBooking,
  createBooking,
  createResource,
  createVenue,
  getVenueAvailability,
  listBookings,
  listResources,
  listVenues,
  listWaitlists,
  updateWaitlistStatus
} from "../src/booking";

describe("booking repository", () => {
  const principal: SessionPrincipal = {
    userId: "user-1",
    email: "manager@example.com",
    displayName: "Venue Manager",
    organizationId: "org-1",
    membershipId: "membership-1",
    role: "ADMIN",
    permissions: ["store.manage", "catalog.manage", "order.create", "store.read"]
  };

  it("lists and creates venues", async () => {
    let insertedVenue: any = null;
    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("venues");
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "venue-1",
                      organization_id: "org-1",
                      name: "Arena 1",
                      slug: "arena-1",
                      description: "Sports complex",
                      address: "Bangkok",
                      timezone: "Asia/Bangkok",
                      slot_duration_minutes: 60,
                      status: "ACTIVE",
                      created_at: "2026-09-17T00:00:00Z",
                      updated_at: "2026-09-17T00:00:00Z"
                    }
                  ],
                  error: null
                })
              })
            }),
            insert: (payload: any) => {
              insertedVenue = payload;
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: "venue-new",
                      ...payload,
                      created_at: "2026-09-17T00:00:00Z",
                      updated_at: "2026-09-17T00:00:00Z"
                    },
                    error: null
                  })
                })
              };
            }
          };
        }
      }
    };

    const venues = await listVenues(mockDb, principal);
    expect(venues.length).toBe(1);
    expect(venues[0]?.name).toBe("Arena 1");

    const created = await createVenue(mockDb, principal, {
      name: "Arena 2",
      slug: "arena-2",
      slotDurationMinutes: 60
    });
    expect(created.name).toBe("Arena 2");
    expect(insertedVenue.slug).toBe("arena-2");
  });

  it("creates booking and detects overlap", async () => {
    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("bookings");
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    lt: () => ({
                      gt: async () => ({
                        data: [
                          {
                            id: "existing-booking",
                            start_at: "2026-09-20T18:00:00.000Z",
                            end_at: "2026-09-20T19:00:00.000Z",
                            status: "CONFIRMED"
                          }
                        ],
                        error: null
                      })
                    })
                  })
                })
              })
            })
          };
        }
      }
    };

    expect(
      createBooking(mockDb, principal, {
        venueId: "venue-1",
        resourceId: "court-1",
        customerName: "Alice",
        startAt: "2026-09-20T18:30:00.000Z",
        endAt: "2026-09-20T19:30:00.000Z",
        amountMinor: 50000
      })
    ).rejects.toThrow("ช่วงเวลาดังกล่าวมีผู้จองแล้ว");
  });

  it("checks in an active booking with checkin code", async () => {
    let updateFields: any = null;
    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("bookings");
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "booking-1",
                        organization_id: "org-1",
                        venue_id: "venue-1",
                        resource_id: "court-1",
                        customer_name: "Bob",
                        start_at: "2026-09-20T10:00:00.000Z",
                        end_at: "2026-09-20T11:00:00.000Z",
                        status: "CONFIRMED",
                        amount_minor: 40000,
                        checkin_code: "BK1234",
                        created_at: "2026-09-17T00:00:00Z",
                        updated_at: "2026-09-17T00:00:00Z"
                      },
                      error: null
                    })
                  })
                })
              })
            }),
            update: (fields: any) => {
              updateFields = fields;
              return {
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: "booking-1",
                        organization_id: "org-1",
                        venue_id: "venue-1",
                        resource_id: "court-1",
                        customer_name: "Bob",
                        start_at: "2026-09-20T10:00:00.000Z",
                        end_at: "2026-09-20T11:00:00.000Z",
                        status: fields.status,
                        checked_in_at: fields.checked_in_at,
                        amount_minor: 40000,
                        checkin_code: "BK1234",
                        created_at: "2026-09-17T00:00:00Z",
                        updated_at: "2026-09-17T00:00:00Z"
                      },
                      error: null
                    })
                  })
                })
              };
            }
          };
        }
      }
    };

    const checkedIn = await checkinBooking(mockDb, principal, "booking-1", "BK1234");
    expect(checkedIn.status).toBe("CHECKED_IN");
    expect(checkedIn.checkedInAt).toBeDefined();
    expect(updateFields.status).toBe("CHECKED_IN");
  });

  it("manages venue waitlists", async () => {
    let insertedWaitlist: any = null;
    let updateFields: any = null;

    const chainableQuery: any = {
      eq: () => chainableQuery,
      order: () => chainableQuery,
      limit: async () => ({
        data: [{ position: 2 }],
        error: null
      })
    };

    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("booking_waitlists");
          return {
            select: () => chainableQuery,
            insert: (payload: any) => {
              insertedWaitlist = payload;
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: "waitlist-3",
                      ...payload,
                      created_at: "2026-09-17T00:00:00Z",
                      updated_at: "2026-09-17T00:00:00Z"
                    },
                    error: null
                  })
                })
              };
            },
            update: (fields: any) => {
              updateFields = fields;
              return {
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => ({
                        data: {
                          id: "waitlist-3",
                          organization_id: "org-1",
                          venue_id: "venue-1",
                          customer_name: "Charlie",
                          party_size: 4,
                          position: 3,
                          status: fields.status,
                          created_at: "2026-09-17T00:00:00Z",
                          updated_at: fields.updated_at
                        },
                        error: null
                      })
                    })
                  })
                })
              };
            }
          };
        }
      }
    };

    const entry = await addToWaitlist(mockDb, principal, {
      venueId: "venue-1",
      customerName: "Charlie",
      partySize: 4
    });

    expect(entry.customerName).toBe("Charlie");
    expect(entry.position).toBe(3);
    expect(insertedWaitlist.position).toBe(3);

    const updated = await updateWaitlistStatus(mockDb, principal, "waitlist-3", "NOTIFIED");
    expect(updated.status).toBe("NOTIFIED");
    expect(updateFields.status).toBe("NOTIFIED");
  });
});

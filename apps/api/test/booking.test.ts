import { describe, expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import type { SessionPrincipal } from "@aevo/contracts";
import { createApp } from "../src/app";
import { encodeAuthSessionCookie } from "../src/http";

const config: AppConfig = {
  nodeEnv: "test",
  apiHost: "127.0.0.1",
  apiPort: 3001,
  webOrigin: "http://localhost:4321",
  supabaseUrl: "https://demo.supabase.co",
  supabaseKey: "server-secret",
  sessionCookieName: "aevo_session",
  sessionCookieSameSite: "lax",
  logLevel: "error"
};

const principal: SessionPrincipal = {
  userId: "user-1",
  email: "manager@example.com",
  displayName: "Venue Manager",
  organizationId: "org-1",
  membershipId: "membership-1",
  role: "ADMIN",
  permissions: ["organization.manage", "store.read", "store.manage", "catalog.manage", "order.create"]
};

const fakeAuth = {
  login: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  refresh: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  logout: async () => undefined,
  resolve: async (token: string) => token === "secret" ? principal : null
};

function cookieHeader() {
  return `aevo_session=${encodeURIComponent(encodeAuthSessionCookie({ accessToken: "secret", refreshToken: "refresh" }))}`;
}

describe("Aevo Booking API endpoints", () => {
  const fakeDatabase: any = {
    ping: async () => undefined,
    close: async () => undefined,
    client: {
      from: (table: string) => {
        if (table === "venues") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "venue-1",
                      organization_id: "org-1",
                      name: "Central Arena",
                      slug: "central-arena",
                      description: "Sports club",
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
            insert: (payload: any) => ({
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
            })
          };
        }

        if (table === "bookable_resources") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({
                    data: [
                      {
                        id: "court-1",
                        organization_id: "org-1",
                        venue_id: "venue-1",
                        name: "Court 1 (Badminton)",
                        resource_type: "COURT",
                        capacity: 4,
                        base_price_minor: 25000,
                        status: "ACTIVE",
                        created_at: "2026-09-17T00:00:00Z",
                        updated_at: "2026-09-17T00:00:00Z"
                      }
                    ],
                    error: null
                  })
                })
              })
            })
          };
        }

        if (table === "bookings") {
          const bookingRecord = {
            id: "00000000-0000-0000-0000-000000000001",
            organization_id: "org-1",
            venue_id: "venue-1",
            resource_id: "court-1",
            customer_name: "Customer A",
            start_at: "2026-09-20T18:00:00.000Z",
            end_at: "2026-09-20T19:00:00.000Z",
            status: "CONFIRMED",
            amount_minor: 25000,
            checkin_code: "CK1234",
            created_at: "2026-09-17T00:00:00Z",
            updated_at: "2026-09-17T00:00:00Z"
          };

          const chainableQuery: any = {
            eq: () => chainableQuery,
            in: () => chainableQuery,
            lt: () => chainableQuery,
            gt: async () => ({ data: [], error: null }),
            gte: () => chainableQuery,
            lte: () => chainableQuery,
            maybeSingle: async () => ({ data: bookingRecord, error: null }),
            single: async () => ({ data: bookingRecord, error: null }),
            order: async () => ({ data: [bookingRecord], error: null })
          };

          return {
            select: () => chainableQuery,
            insert: (payload: any) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "booking-new",
                    ...payload,
                    created_at: "2026-09-17T00:00:00Z",
                    updated_at: "2026-09-17T00:00:00Z"
                  },
                  error: null
                })
              })
            }),
            update: (fields: any) => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      id: "00000000-0000-0000-0000-000000000001",
                      organization_id: "org-1",
                      venue_id: "venue-1",
                      resource_id: "court-1",
                      customer_name: "Customer A",
                      start_at: "2026-09-20T18:00:00.000Z",
                      end_at: "2026-09-20T19:00:00.000Z",
                      status: fields.status,
                      checked_in_at: fields.checked_in_at,
                      amount_minor: 25000,
                      created_at: "2026-09-17T00:00:00Z",
                      updated_at: "2026-09-17T00:00:00Z"
                    },
                    error: null
                  })
                })
              })
            })
          };
        }

        if (table === "booking_waitlists") {
          const chainableWaitlist: any = {
            eq: () => chainableWaitlist,
            order: () => chainableWaitlist,
            limit: async () => ({ data: [{ position: 1 }], error: null }),
            then: (resolve: any) => resolve({
              data: [
                {
                  id: "00000000-0000-0000-0000-000000000001",
                  organization_id: "org-1",
                  venue_id: "venue-1",
                  customer_name: "Walk-in Guest",
                  party_size: 2,
                  position: 1,
                  status: "WAITING",
                  created_at: "2026-09-17T00:00:00Z",
                  updated_at: "2026-09-17T00:00:00Z"
                }
              ],
              error: null
            })
          };
          return {
            select: () => chainableWaitlist,
            insert: (payload: any) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "00000000-0000-0000-0000-000000000002",
                    ...payload,
                    created_at: "2026-09-17T00:00:00Z",
                    updated_at: "2026-09-17T00:00:00Z"
                  },
                  error: null
                })
              })
            }),
            update: (fields: any) => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: "00000000-0000-0000-0000-000000000001",
                        organization_id: "org-1",
                        venue_id: "venue-1",
                        customer_name: "Walk-in Guest",
                        party_size: 2,
                        position: 1,
                        status: fields.status,
                        created_at: "2026-09-17T00:00:00Z",
                        updated_at: fields.updated_at
                      },
                      error: null
                    })
                  })
                })
              })
            })
          };
        }

        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        };
      }
    }
  };

  const app = createApp({ config, database: fakeDatabase, auth: fakeAuth });

  test("GET /api/booking/venues returns venues for authenticated organization", async () => {
    const res = await app.handle(new Request("http://localhost/api/booking/venues", {
      headers: { cookie: cookieHeader() }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.venues).toBeDefined();
    expect(body.venues.length).toBe(1);
    expect(body.venues[0].slug).toBe("central-arena");
  });

  test("POST /api/booking/venues creates a new venue", async () => {
    const res = await app.handle(new Request("http://localhost/api/booking/venues", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: "http://localhost:4321",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: "North Arena",
        slug: "north-arena",
        slotDurationMinutes: 60
      })
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.venue).toBeDefined();
    expect(body.venue.name).toBe("North Arena");
  });

  test("POST /api/booking/bookings creates a confirmed booking", async () => {
    const res = await app.handle(new Request("http://localhost/api/booking/bookings", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: "http://localhost:4321",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        venueId: "00000000-0000-0000-0000-000000000001",
        resourceId: "00000000-0000-0000-0000-000000000002",
        customerName: "Charlie",
        startAt: "2026-09-20T14:00:00.000Z",
        endAt: "2026-09-20T15:00:00.000Z",
        amountMinor: 25000
      })
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking).toBeDefined();
    expect(body.booking.customerName).toBe("Charlie");
    expect(body.booking.status).toBe("CONFIRMED");
    expect(body.booking.checkinCode).toBeDefined();
  });

  test("POST /api/booking/bookings/:bookingId/checkin checks in customer", async () => {
    const res = await app.handle(new Request("http://localhost/api/booking/bookings/00000000-0000-0000-0000-000000000001/checkin", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: "http://localhost:4321",
        "content-type": "application/json"
      },
      body: JSON.stringify({ code: "CK1234" })
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking).toBeDefined();
    expect(body.booking.status).toBe("CHECKED_IN");
  });

  test("GET /api/booking/venues/:venueId/waitlist returns waiting list", async () => {
    const res = await app.handle(new Request("http://localhost/api/booking/venues/00000000-0000-0000-0000-000000000001/waitlist", {
      headers: { cookie: cookieHeader() }
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waitlist).toBeDefined();
    expect(body.waitlist.length).toBe(1);
    expect(body.waitlist[0].customerName).toBe("Walk-in Guest");
  });

  test("POST /api/booking/venues/:venueId/waitlist adds entry to waitlist", async () => {
    const res = await app.handle(new Request("http://localhost/api/booking/venues/00000000-0000-0000-0000-000000000001/waitlist", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: "http://localhost:4321",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        customerName: "David",
        partySize: 3,
        estimatedWaitMinutes: 20
      })
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry).toBeDefined();
    expect(body.entry.customerName).toBe("David");
    expect(body.entry.status).toBe("WAITING");
  });
});

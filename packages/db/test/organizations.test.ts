import { describe, expect, it } from "bun:test";
import {
  createOrganization,
  createStore,
  getOrganizationStats,
  listOrganizationStores,
  listUserOrganizations
} from "../src/organizations";
import type { Database } from "../src/client";

function createMockDatabase() {
  const orgs = [
    { id: "org-1", name: "Aevo Demo", slug: "aevo-demo", status: "ACTIVE", created_at: new Date().toISOString() }
  ];
  const memberships = [
    { id: "mem-1", organization_id: "org-1", user_id: "usr-1", role_id: "role-owner", status: "ACTIVE", created_at: new Date().toISOString() }
  ];
  const roles = [
    { id: "role-owner", code: "OWNER" },
    { id: "role-admin", code: "ADMIN" }
  ];
  const stores = [
    { id: "store-1", organization_id: "org-1", name: "Main Store", code: "MAIN", timezone: "Asia/Bangkok", status: "ACTIVE" }
  ];
  const subscriptions = [
    { id: "sub-1", organization_id: "org-1", app_id: "pos", status: "ACTIVE" }
  ];

  const client = {
    from: (table: string) => {
      if (table === "memberships") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              eq: () => ({
                error: null,
                data: memberships.filter((m) => m.user_id === val)
              }),
              count: memberships.length
            })
          }),
          insert: (item: any) => {
            const newItem = { id: `mem-${Date.now()}`, ...item };
            memberships.push(newItem);
            return {
              select: () => ({ single: async () => ({ error: null, data: newItem }) })
            };
          }
        };
      }
      if (table === "organizations") {
        return {
          select: () => ({
            in: () => ({ error: null, data: orgs })
          }),
          insert: (item: any) => {
            const newItem = { id: `org-${Date.now()}`, ...item, created_at: new Date().toISOString() };
            orgs.push(newItem);
            return {
              select: () => ({ single: async () => ({ error: null, data: newItem }) })
            };
          }
        };
      }
      if (table === "roles") {
        return {
          select: () => ({
            in: () => ({ error: null, data: roles }),
            eq: () => ({ single: async () => ({ error: null, data: roles[0] }) })
          })
        };
      }
      if (table === "stores") {
        return {
          select: (_cols: any, opts?: any) => {
            if (opts?.head) {
              return {
                eq: () => ({
                  eq: () => ({ error: null, count: stores.length })
                })
              };
            }
            return {
              eq: () => ({
                eq: () => ({
                  order: () => ({ error: null, data: stores })
                })
              })
            };
          },
          insert: (item: any) => {
            const newItem = { id: `store-${Date.now()}`, ...item };
            stores.push(newItem);
            return {
              select: () => ({ single: async () => ({ error: null, data: newItem }) })
            };
          }
        };
      }
      if (table === "apps") {
        return {
          select: () => ({ count: 5 })
        };
      }
      if (table === "app_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({ error: null, count: subscriptions.length })
            })
          }),
          insert: async () => ({ error: null })
        };
      }
      if (table === "membership_stores") {
        return {
          insert: async () => ({ error: null })
        };
      }
      return {
        select: () => ({ error: null, data: [] })
      };
    }
  };

  return { client, authClient: client } as unknown as Database;
}

describe("organizations repository", () => {
  it("lists user organizations with resolved role", async () => {
    const db = createMockDatabase();
    const orgs = await listUserOrganizations(db, "usr-1");

    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.name).toBe("Aevo Demo");
    expect(orgs[0]!.role).toBe("OWNER");
  });

  it("creates a new organization with owner membership, default store, and POS trial", async () => {
    const db = createMockDatabase();
    const newOrg = await createOrganization(db, "usr-1", {
      name: "Chakkaphan Sports Club"
    });

    expect(newOrg.id).toBeDefined();
    expect(newOrg.name).toBe("Chakkaphan Sports Club");
    expect(newOrg.role).toBe("OWNER");
    expect(newOrg.status).toBe("ACTIVE");
  });

  it("lists and creates stores for organization", async () => {
    const db = createMockDatabase();
    const stores = await listOrganizationStores(db, "org-1");
    expect(stores).toHaveLength(1);
    expect(stores[0]!.code).toBe("MAIN");

    const newStore = await createStore(db, "org-1", {
      name: "Siam Branch",
      code: "SIAM"
    });
    expect(newStore.code).toBe("SIAM");
  });

  it("aggregates organization metrics in getOrganizationStats", async () => {
    const db = createMockDatabase();
    const stats = await getOrganizationStats(db, "org-1");

    expect(stats.totalApps).toBe(5);
    expect(stats.activeApps).toBe(1);
  });
});

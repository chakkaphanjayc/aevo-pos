import { expect, test } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import { canAccessStore, listAuthorizedStores, type Database } from "../src";

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private limitValue: number | undefined;
  private orderField: string | undefined;
  private ascending = true;

  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this; }
  in(field: string, values: unknown[]) { this.filters.push((row) => values.includes(row[field])); return this; }
  order(field: string, options?: { ascending?: boolean }) { this.orderField = field; this.ascending = options?.ascending ?? true; return this; }
  limit(value: number) { this.limitValue = value; return this; }
  private result() {
    let data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.orderField) {
      const field = this.orderField;
      data = [...data].sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (this.ascending ? 1 : -1));
    }
    if (this.limitValue !== undefined) data = data.slice(0, this.limitValue);
    return { data, error: null };
  }
  async maybeSingle() {
    const result = this.result();
    return { data: result.data[0] ?? null, error: result.data.length > 1 ? { message: "multiple rows" } : null };
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

class FakeClient {
  constructor(private readonly tables: Record<string, Row[]>) {}
  from(table: string) { return new FakeQuery(this.tables[table] ?? []); }
}

function makeDatabase(tables: Record<string, Row[]>): Database {
  return { client: new FakeClient(tables) as never, ping: async () => undefined, close: async () => undefined };
}

const organizationA = "00000000-0000-4000-8000-000000000001";
const organizationB = "00000000-0000-4000-8000-000000000002";
const storeA = "00000000-0000-4000-8000-000000000011";
const storeB = "00000000-0000-4000-8000-000000000012";
const membershipA = "00000000-0000-4000-8000-000000000021";

const tables = {
  stores: [
    { id: storeA, organization_id: organizationA, name: "A Store", code: "A", timezone: "Asia/Bangkok", status: "ACTIVE" },
    { id: storeB, organization_id: organizationB, name: "B Store", code: "B", timezone: "Asia/Bangkok", status: "ACTIVE" }
  ],
  membership_stores: [{ membership_id: membershipA, store_id: storeA }]
};

test("store access never crosses organization boundaries", async () => {
  const database = makeDatabase(tables);
  const ownerA: SessionPrincipal = {
    userId: "user-a", email: "owner-a@example.com", membershipId: membershipA,
    organizationId: organizationA, role: "OWNER", permissions: ["store.read"]
  };
  expect(await canAccessStore(database, ownerA, storeA)).toBeTrue();
  expect(await canAccessStore(database, ownerA, storeB)).toBeFalse();

  const cashierA: SessionPrincipal = { ...ownerA, role: "CASHIER" };
  expect(await canAccessStore(database, cashierA, storeA)).toBeTrue();
  expect(await canAccessStore(database, cashierA, storeB)).toBeFalse();
  expect(await listAuthorizedStores(database, cashierA)).toEqual([
    { id: storeA, organizationId: organizationA, name: "A Store", code: "A", timezone: "Asia/Bangkok" }
  ]);
});

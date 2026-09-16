import { describe, expect, test } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import { hasPermission, requirePermission } from "../src";

const principal: SessionPrincipal = {
  userId: "user", email: "cashier@example.com", organizationId: "org",
  membershipId: "membership", role: "CASHIER",
  permissions: ["store.read", "order.create", "payment.receive"]
};

describe("RBAC", () => {
  test("allows granted permissions", () => expect(hasPermission(principal, "order.create")).toBeTrue());
  test("rejects sensitive ungranted operations", () => {
    expect(() => requirePermission(principal, "refund.create")).toThrow("refund.create");
  });
});

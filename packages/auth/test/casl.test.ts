import { describe, expect, it } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import { defineAbilityFor } from "../src/casl";

describe("CASL AppAbility", () => {
  const staffPrincipal: SessionPrincipal = {
    userId: "user-1",
    email: "cashier@example.com",
    displayName: "Cashier Joe",
    organizationId: "org-1",
    membershipId: "mem-1",
    role: "CASHIER",
    permissions: ["order.create", "order.read", "catalog.read"]
  };

  const ownerPrincipal: SessionPrincipal = {
    userId: "user-99",
    email: "owner@example.com",
    displayName: "Owner Boss",
    organizationId: "org-1",
    membershipId: "mem-99",
    role: "OWNER",
    permissions: ["organization.manage", "store.manage"]
  };

  it("evaluates fine-grained abilities for staff role", () => {
    const ability = defineAbilityFor(staffPrincipal);

    expect(ability.can("create", "Order")).toBe(true);
    expect(ability.can("read", "Order")).toBe(true);
    expect(ability.can("void", "Order")).toBe(false);
    expect(ability.cannot("void", "Order")).toBe(true);

    expect(ability.can("read", "Catalog")).toBe(true);
    expect(ability.can("manage", "Catalog")).toBe(false);

    expect(ability.can("manage", "Device")).toBe(false);
    expect(ability.can("manage", "Subscription")).toBe(false);
  });

  it("grants unrestricted management to OWNER", () => {
    const ability = defineAbilityFor(ownerPrincipal);

    expect(ability.can("manage", "all")).toBe(true);
    expect(ability.can("create", "Order")).toBe(true);
    expect(ability.can("void", "Order")).toBe(true);
    expect(ability.can("manage", "Subscription")).toBe(true);
  });

  it("respects AppEntitlement for guarded domains like Booking", () => {
    const managerPrincipal: SessionPrincipal = {
      userId: "user-2",
      email: "manager@example.com",
      displayName: "Manager",
      organizationId: "org-1",
      membershipId: "mem-2",
      role: "BRANCH_MANAGER",
      permissions: ["order.create", "store.manage"]
    };

    // When booking is NOT entitled
    const abilityWithoutBooking = defineAbilityFor(managerPrincipal, [
      { appId: "booking", isEntitled: false, status: "UNSUBSCRIBED" }
    ]);
    expect(abilityWithoutBooking.can("manage", "Booking")).toBe(false);

    // When booking IS entitled
    const abilityWithBooking = defineAbilityFor(managerPrincipal, [
      { appId: "booking", isEntitled: true, status: "ACTIVE" }
    ]);
    expect(abilityWithBooking.can("manage", "Booking")).toBe(true);
  });
});

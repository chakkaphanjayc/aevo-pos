import type {
  AppEntitlement,
  Permission,
  PolicyAction,
  PolicyRule,
  PolicySubject,
  SessionPrincipal
} from "@aevo/contracts";

export class AppAbility {
  constructor(private readonly rules: PolicyRule[]) {}

  can(action: PolicyAction, subject: PolicySubject): boolean {
    for (const rule of this.rules) {
      const actionMatches = Array.isArray(rule.action)
        ? rule.action.includes(action) || rule.action.includes("manage")
        : rule.action === action || rule.action === "manage";

      const subjectMatches = Array.isArray(rule.subject)
        ? rule.subject.includes(subject) || rule.subject.includes("all")
        : rule.subject === subject || rule.subject === "all";

      if (actionMatches && subjectMatches) {
        return !rule.inverted;
      }
    }
    return false;
  }

  cannot(action: PolicyAction, subject: PolicySubject): boolean {
    return !this.can(action, subject);
  }

  getRules(): PolicyRule[] {
    return [...this.rules];
  }
}

export function defineAbilityFor(
  principal: SessionPrincipal,
  entitlements?: AppEntitlement[]
): AppAbility {
  const rules: PolicyRule[] = [];
  const permissions = new Set<Permission>(principal.permissions);

  // Super admin / Owner has unrestricted access
  if (principal.role === "OWNER") {
    rules.push({ action: "manage", subject: "all" });
    return new AppAbility(rules);
  }

  // Order management
  if (permissions.has("order.create")) {
    rules.push({ action: ["create", "read"], subject: "Order" });
  }
  if (permissions.has("order.read")) {
    rules.push({ action: "read", subject: "Order" });
  }
  if (permissions.has("order.void")) {
    rules.push({ action: "void", subject: "Order" });
  }

  // Catalog management
  if (permissions.has("catalog.manage")) {
    rules.push({ action: "manage", subject: "Catalog" });
  } else if (permissions.has("catalog.read")) {
    rules.push({ action: "read", subject: "Catalog" });
  }

  // Store & Device management
  if (permissions.has("store.manage")) {
    rules.push({ action: "manage", subject: ["Table", "CashSession"] });
  } else if (permissions.has("store.read")) {
    rules.push({ action: "read", subject: ["Table", "CashSession"] });
  }

  if (permissions.has("devices.manage")) {
    rules.push({ action: "manage", subject: "Device" });
  }

  // Members & Roles
  if (permissions.has("member.manage")) {
    rules.push({ action: "manage", subject: "User" });
  }

  // Reports
  if (permissions.has("audit.read")) {
    rules.push({ action: ["read", "export"], subject: "Report" });
  }

  // Booking Domain (Guarded by App Entitlement if provided)
  const bookingEntitled = entitlements ? entitlements.find((e) => e.appId === "booking")?.isEntitled ?? false : true;
  if (bookingEntitled) {
    if (permissions.has("order.create") || permissions.has("store.manage")) {
      rules.push({ action: "manage", subject: "Booking" });
    } else if (permissions.has("store.read")) {
      rules.push({ action: "read", subject: "Booking" });
    }
  }

  // Subscription management
  if (permissions.has("organization.manage")) {
    rules.push({ action: "manage", subject: "Subscription" });
  }

  return new AppAbility(rules);
}

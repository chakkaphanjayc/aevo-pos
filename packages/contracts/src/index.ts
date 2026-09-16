export const roles = [
  "OWNER", "ADMIN", "BRANCH_MANAGER", "CASHIER", "KITCHEN", "STAFF", "VIEWER"
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "organization.manage", "store.read", "store.manage", "member.manage",
  "catalog.read", "catalog.manage", "order.read", "order.create",
  "payment.receive", "refund.create", "order.void", "price.override",
  "cash_drawer.open", "integration.manage", "audit.read"
] as const;

export type Permission = (typeof permissions)[number];

export const catalogChannels = ["POS", "QR", "KIOSK", "PICKUP", "STAFF", "API"] as const;
export type CatalogChannel = (typeof catalogChannels)[number];

export type CatalogStatus = "ACTIVE" | "INACTIVE";
export type ProductStatus = "ACTIVE" | "ARCHIVED";

export interface CategorySummary {
  id: string;
  organizationId: string;
  parentId?: string;
  code: string;
  name: string;
  slug: string;
  sortOrder: number;
  status: CatalogStatus;
}

export interface ProductVariantSummary {
  id: string;
  code: string;
  name: string;
  priceMinor: number;
  sortOrder: number;
  status: CatalogStatus;
}

export interface ProductAvailabilitySummary {
  channel: CatalogChannel;
  isAvailable: boolean;
  soldOut: boolean;
  priceOverrideMinor?: number;
}

export interface ProductSummary {
  id: string;
  organizationId: string;
  categoryId?: string;
  sku: string;
  name: string;
  description: string;
  basePriceMinor: number;
  currency: string;
  status: ProductStatus;
  variants: ProductVariantSummary[];
  availability: ProductAvailabilitySummary[];
}

export interface CatalogSnapshot {
  categories: CategorySummary[];
  products: ProductSummary[];
  menus: MenuSummary[];
  modifierGroups: ModifierGroupSummary[];
}

export interface MenuSummary {
  id: string;
  organizationId: string;
  storeId: string;
  code: string;
  name: string;
  channel: CatalogChannel;
  status: CatalogStatus;
  items: MenuItemSummary[];
}

export interface MenuItemSummary {
  id: string;
  menuId: string;
  productId: string;
  variantId?: string;
  priceOverrideMinor?: number;
  sortOrder: number;
  isAvailable: boolean;
  soldOut: boolean;
}

export interface ModifierSummary {
  id: string;
  code: string;
  name: string;
  priceDeltaMinor: number;
  sortOrder: number;
  status: CatalogStatus;
}

export interface ModifierGroupSummary {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelections: number;
  maxSelections: number;
  required: boolean;
  modifiers: ModifierSummary[];
  status: CatalogStatus;
}

export interface CreateCategoryInput {
  storeId: string;
  name: string;
  code?: string;
  parentId?: string;
}

export interface CreateProductVariantInput {
  code: string;
  name: string;
  priceMinor: number;
}

export interface CreateMenuInput {
  storeId: string;
  code?: string;
  name: string;
  channel: CatalogChannel;
}

export interface CreateMenuItemInput {
  storeId: string;
  menuId: string;
  productId: string;
  variantId?: string;
  priceOverrideMinor?: number | null;
}

export interface CreateModifierInput {
  code: string;
  name: string;
  priceDeltaMinor?: number;
}

export interface CreateModifierGroupInput {
  storeId: string;
  code?: string;
  name: string;
  selectionType?: "SINGLE" | "MULTIPLE";
  minSelections?: number;
  maxSelections?: number;
  required?: boolean;
  modifiers?: CreateModifierInput[];
}

export interface CreateProductInput {
  storeId: string;
  categoryId?: string;
  sku: string;
  name: string;
  description?: string;
  basePriceMinor: number;
  currency?: string;
  variants?: CreateProductVariantInput[];
}

export interface UpdateProductInput {
  categoryId?: string | null;
  name?: string;
  description?: string;
  basePriceMinor?: number;
  status?: ProductStatus;
}

export interface UpdateProductAvailabilityInput {
  storeId: string;
  channel: CatalogChannel;
  isAvailable?: boolean;
  soldOut?: boolean;
  priceOverrideMinor?: number | null;
}

export interface SessionPrincipal {
  userId: string;
  email: string;
  /** Display name is optional for backwards-compatible session payloads. */
  displayName?: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  permissions: Permission[];
}

export interface StoreSummary {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  timezone: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

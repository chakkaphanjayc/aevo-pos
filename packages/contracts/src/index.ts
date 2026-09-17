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

/** All ordering surfaces write to the same Order aggregate. */
export const orderChannels = catalogChannels;
export type OrderChannel = (typeof orderChannels)[number];

export const fulfillmentTypes = ["TAKEAWAY", "DINE_IN", "PICKUP"] as const;
export type FulfillmentType = (typeof fulfillmentTypes)[number];

export const orderStatuses = [
  "DRAFT", "PENDING_PAYMENT", "PAID", "CONFIRMED", "QUEUED", "ACCEPTED",
  "PREPARING", "PARTIALLY_READY", "READY", "SERVED", "PICKED_UP", "COMPLETED",
  "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "NO_SHOW"
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const paymentStatuses = ["UNPAID", "PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export const paymentMethods = ["CASH", "PROMPTPAY", "EXTERNAL_CARD", "MANUAL"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

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

export interface ProductModifierGroupMapping {
  productId: string;
  modifierGroupId: string;
  sortOrder: number;
}

export interface CatalogSnapshot {
  categories: CategorySummary[];
  products: ProductSummary[];
  menus: MenuSummary[];
  modifierGroups: ModifierGroupSummary[];
  productModifierGroups: ProductModifierGroupMapping[];
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

export interface CreateOrderItemInput {
  productId: string;
  variantId?: string;
  menuItemId?: string;
  modifierIds?: string[];
  quantity: number;
  note?: string;
}

export interface CreateOrderInput {
  storeId: string;
  channel: OrderChannel;
  fulfillmentType: FulfillmentType;
  currency?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  items: CreateOrderItemInput[];
}

export interface OrderItemModifierSummary {
  id: string;
  modifierId: string;
  modifierGroupId: string;
  name: string;
  priceDeltaMinor: number;
  quantity: number;
}

export interface OrderItemSummary {
  id: string;
  lineNumber: number;
  productId: string;
  variantId?: string;
  menuItemId?: string;
  sku: string;
  productName: string;
  variantName?: string;
  unitPriceMinor: number;
  quantity: number;
  subtotalMinor: number;
  note?: string;
  modifiers: OrderItemModifierSummary[];
}

export interface OrderSummary {
  id: string;
  organizationId: string;
  storeId: string;
  orderNumber: string;
  channel: OrderChannel;
  fulfillmentType: FulfillmentType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  items: OrderItemSummary[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem {
  id: string;
  organizationId: string;
  storeId: string;
  orderNumber: string;
  channel: OrderChannel;
  fulfillmentType: FulfillmentType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  totalMinor: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionOrderInput {
  storeId: string;
  toStatus: OrderStatus;
  expectedStatus?: OrderStatus;
  reason?: string;
}

export interface RecordPaymentInput {
  storeId: string;
  method: PaymentMethod;
  amountMinor: number;
  currency?: string;
  providerReference?: string;
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

export interface TableSummary {
  id: string;
  organizationId: string;
  storeId: string;
  tableNumber: string;
  label?: string;
  qrCodeUrl?: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface PublicProductItem {
  id: string;
  categoryId?: string;
  name: string;
  description: string;
  basePriceMinor: number;
  effectivePriceMinor: number;
  currency: string;
  soldOut: boolean;
  variants: ProductVariantSummary[];
  modifierGroups: ModifierGroupSummary[];
}

export interface PublicCatalogCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface PublicCatalogSnapshot {
  store: {
    id: string;
    code: string;
    name: string;
    currency: string;
  };
  channel: CatalogChannel;
  categories: PublicCatalogCategory[];
  products: PublicProductItem[];
}

export interface CreatePublicOrderInput {
  storeCode: string;
  channel: "QR";
  fulfillmentType: "TAKEAWAY" | "DINE_IN";
  tableNumber?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  items: Array<{
    productId: string;
    variantId?: string;
    modifierIds?: string[];
    quantity: number;
    note?: string;
  }>;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

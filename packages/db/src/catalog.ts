import type {
  CatalogChannel,
  CatalogSnapshot,
  CategorySummary,
  CreateCategoryInput,
  CreateMenuInput,
  CreateMenuItemInput,
  CreateModifierGroupInput,
  CreateProductInput,
  ProductAvailabilitySummary,
  ProductModifierGroupMapping,
  ProductSummary,
  ProductVariantSummary,
  MenuSummary,
  MenuItemSummary,
  ModifierGroupSummary,
  ModifierSummary,
  PublicCatalogCategory,
  PublicCatalogSnapshot,
  PublicProductItem,
  SessionPrincipal,
  UpdateProductAvailabilityInput,
  UpdateProductInput
} from "@aevo/contracts";
import { catalogChannels } from "@aevo/contracts";
import type { Database } from "./client";

type Row = Record<string, unknown>;

export class CatalogConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogConflictError";
  }
}

function throwIfError(error: { message: string; code?: string } | null, operation: string): void {
  if (!error) return;
  if (error.code === "23505") throw new CatalogConflictError(`Catalog ${operation} already exists`);
  throw new Error(`Supabase catalog ${operation} failed: ${error.message}`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

function slugify(value: string): string {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 63);
  return slug || `item-${stableHash(value)}`;
}

function codeFrom(value: string, fallback: string): string {
  const code = value.toUpperCase().trim().replace(/[^A-Z0-9_-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);
  return code || fallback;
}

function mapCategory(row: Row): CategorySummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    ...(optionalString(row.parent_id) ? { parentId: String(row.parent_id) } : {}),
    code: String(row.code),
    name: String(row.name),
    slug: String(row.slug),
    sortOrder: Number(row.sort_order ?? 0),
    status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"
  };
}

function mapVariant(row: Row): ProductVariantSummary {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    priceMinor: Number(row.price_minor ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
    status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"
  };
}

function mapAvailability(row: Row): ProductAvailabilitySummary {
  const channel = String(row.channel);
  return {
    channel: (catalogChannels.includes(channel as CatalogChannel) ? channel : "POS") as CatalogChannel,
    isAvailable: row.is_available !== false,
    soldOut: row.sold_out === true,
    ...(row.price_override_minor === null || row.price_override_minor === undefined
      ? {}
      : { priceOverrideMinor: Number(row.price_override_minor) })
  };
}

function mapProduct(row: Row, variants: ProductVariantSummary[], availability: ProductAvailabilitySummary[]): ProductSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    ...(optionalString(row.category_id) ? { categoryId: String(row.category_id) } : {}),
    sku: String(row.sku),
    name: String(row.name),
    description: String(row.description ?? ""),
    basePriceMinor: Number(row.base_price_minor ?? 0),
    currency: String(row.currency ?? "THB"),
    status: row.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    variants,
    availability
  };
}

function mapMenu(row: Row, items: MenuItemSummary[] = []): MenuSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    code: String(row.code),
    name: String(row.name),
    channel: (catalogChannels.includes(String(row.channel) as CatalogChannel) ? String(row.channel) : "POS") as CatalogChannel,
    status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    items
  };
}

function mapMenuItem(row: Row): MenuItemSummary {
  return {
    id: String(row.id),
    menuId: String(row.menu_id),
    productId: String(row.product_id),
    ...(optionalString(row.variant_id) ? { variantId: String(row.variant_id) } : {}),
    ...(row.price_override_minor === null || row.price_override_minor === undefined
      ? {}
      : { priceOverrideMinor: Number(row.price_override_minor) }),
    sortOrder: Number(row.sort_order ?? 0),
    isAvailable: row.is_available !== false,
    soldOut: row.sold_out === true
  };
}

function mapModifier(row: Row): ModifierSummary {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    priceDeltaMinor: Number(row.price_delta_minor ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
    status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"
  };
}

function mapModifierGroup(row: Row, modifiers: ModifierSummary[]): ModifierGroupSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    code: String(row.code),
    name: String(row.name),
    selectionType: row.selection_type === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
    minSelections: Number(row.min_selections ?? 0),
    maxSelections: Number(row.max_selections ?? 1),
    required: row.required === true,
    modifiers,
    status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"
  };
}

export function slugifyCatalogName(value: string): string {
  return slugify(value);
}

export function validateCatalogChannel(value: string): value is CatalogChannel {
  return catalogChannels.includes(value as CatalogChannel);
}

/**
 * Encode PATCH presence separately from PATCH values. The database RPC uses
 * these flags inside one INSERT ... ON CONFLICT statement, so two concurrent
 * requests changing different fields cannot overwrite each other's updates.
 */
export function buildAvailabilityPatchParams(
  input: UpdateProductAvailabilityInput,
  principal: SessionPrincipal,
  productId: string
): Row {
  return {
    p_organization_id: principal.organizationId,
    p_store_id: input.storeId,
    p_product_id: productId,
    p_channel: input.channel,
    p_is_available: input.isAvailable ?? null,
    p_is_available_set: input.isAvailable !== undefined,
    p_sold_out: input.soldOut ?? null,
    p_sold_out_set: input.soldOut !== undefined,
    p_price_override_minor: input.priceOverrideMinor ?? null,
    p_price_override_set: input.priceOverrideMinor !== undefined
  };
}

export async function listCatalog(database: Database, principal: SessionPrincipal, storeId: string): Promise<CatalogSnapshot> {
  const [categoriesResult, productsResult, variantsResult, availabilityResult, menusResult, menuItemsResult, modifierGroupsResult, modifiersResult, productModifierGroupsResult] = await Promise.all([
    database.client
      .from("categories")
      .select("id,organization_id,parent_id,code,name,slug,sort_order,status")
      .eq("organization_id", principal.organizationId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    database.client
      .from("products")
      .select("id,organization_id,category_id,sku,name,description,base_price_minor,currency,status")
      .eq("organization_id", principal.organizationId)
      .order("name", { ascending: true }),
    database.client
      .from("product_variants")
      .select("id,organization_id,product_id,code,name,price_minor,sort_order,status")
      .eq("organization_id", principal.organizationId)
      .order("sort_order", { ascending: true }),
    database.client
      .from("product_availability")
      .select("organization_id,store_id,product_id,channel,is_available,sold_out,price_override_minor")
      .eq("organization_id", principal.organizationId)
      .eq("store_id", storeId),
    database.client
      .from("menus")
      .select("id,organization_id,store_id,code,name,channel,status")
      .eq("organization_id", principal.organizationId)
      .eq("store_id", storeId)
      .order("name", { ascending: true }),
    database.client
      .from("menu_items")
      .select("id,organization_id,menu_id,product_id,variant_id,price_override_minor,sort_order,is_available,sold_out")
      .eq("organization_id", principal.organizationId)
      .order("sort_order", { ascending: true }),
    database.client
      .from("modifier_groups")
      .select("id,organization_id,code,name,selection_type,min_selections,max_selections,required,status")
      .eq("organization_id", principal.organizationId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    database.client
      .from("modifiers")
      .select("id,organization_id,modifier_group_id,code,name,price_delta_minor,sort_order,status")
      .eq("organization_id", principal.organizationId)
      .order("sort_order", { ascending: true }),
    database.client
      .from("product_modifier_groups")
      .select("organization_id,product_id,modifier_group_id,sort_order")
      .eq("organization_id", principal.organizationId)
      .order("sort_order", { ascending: true })
  ]);
  throwIfError(categoriesResult.error, "category list");
  throwIfError(productsResult.error, "product list");
  throwIfError(variantsResult.error, "variant list");
  throwIfError(availabilityResult.error, "availability list");
  throwIfError(menusResult.error, "menu list");
  throwIfError(menuItemsResult.error, "menu item list");
  throwIfError(modifierGroupsResult.error, "modifier group list");
  if (productModifierGroupsResult.error && productModifierGroupsResult.error.code !== "PGRST205") {
    throwIfError(productModifierGroupsResult.error, "product modifier group list");
  }

  const variantsByProduct = new Map<string, ProductVariantSummary[]>();
  for (const row of (variantsResult.data ?? []) as Row[]) {
    const productId = String(row.product_id);
    const items = variantsByProduct.get(productId) ?? [];
    items.push(mapVariant(row));
    variantsByProduct.set(productId, items);
  }
  const availabilityByProduct = new Map<string, ProductAvailabilitySummary[]>();
  for (const row of (availabilityResult.data ?? []) as Row[]) {
    const productId = String(row.product_id);
    const items = availabilityByProduct.get(productId) ?? [];
    items.push(mapAvailability(row));
    availabilityByProduct.set(productId, items);
  }
  const modifiersByGroup = new Map<string, ModifierSummary[]>();
  for (const row of (modifiersResult.data ?? []) as Row[]) {
    const groupId = String(row.modifier_group_id);
    const items = modifiersByGroup.get(groupId) ?? [];
    items.push(mapModifier(row));
    modifiersByGroup.set(groupId, items);
  }
  const menuIds = new Set(((menusResult.data ?? []) as Row[]).map((row) => String(row.id)));
  const menuItemsByMenu = new Map<string, MenuItemSummary[]>();
  for (const row of (menuItemsResult.data ?? []) as Row[]) {
    const menuId = String(row.menu_id);
    if (!menuIds.has(menuId)) continue;
    const items = menuItemsByMenu.get(menuId) ?? [];
    items.push(mapMenuItem(row));
    menuItemsByMenu.set(menuId, items);
  }
  return {
    categories: ((categoriesResult.data ?? []) as Row[]).map(mapCategory),
    products: ((productsResult.data ?? []) as Row[]).map((row) => mapProduct(
      row,
      variantsByProduct.get(String(row.id)) ?? [],
      availabilityByProduct.get(String(row.id)) ?? []
    )),
    menus: ((menusResult.data ?? []) as Row[]).map((row) => mapMenu(row, menuItemsByMenu.get(String(row.id)) ?? [])),
    modifierGroups: ((modifierGroupsResult.data ?? []) as Row[]).map((row) => mapModifierGroup(
      row,
      modifiersByGroup.get(String(row.id)) ?? []
    )),
    productModifierGroups: ((productModifierGroupsResult.data ?? []) as Row[]).map((row): ProductModifierGroupMapping => ({
      productId: String(row.product_id),
      modifierGroupId: String(row.modifier_group_id),
      sortOrder: Number(row.sort_order ?? 0)
    }))
  };
}

export async function createCategory(
  database: Database,
  principal: SessionPrincipal,
  input: CreateCategoryInput
): Promise<CategorySummary> {
  const slug = slugify(input.name);
  const code = codeFrom(input.code ?? "", codeFrom(slug.replace(/-/g, "_"), "CATEGORY"));
  const result = await database.client
    .from("categories")
    .insert({
      organization_id: principal.organizationId,
      ...(input.parentId ? { parent_id: input.parentId } : {}),
      code,
      name: input.name.trim(),
      slug
    })
    .select("id,organization_id,parent_id,code,name,slug,sort_order,status")
    .single();
  throwIfError(result.error, "category create");
  return mapCategory(result.data as Row);
}

export async function createProduct(
  database: Database,
  principal: SessionPrincipal,
  input: CreateProductInput
): Promise<ProductSummary> {
  const productResult = await database.client
    .from("products")
    .insert({
      organization_id: principal.organizationId,
      ...(input.categoryId ? { category_id: input.categoryId } : {}),
      sku: input.sku.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      base_price_minor: input.basePriceMinor,
      currency: input.currency?.trim().toUpperCase() || "THB"
    })
    .select("id,organization_id,category_id,sku,name,description,base_price_minor,currency,status")
    .single();
  throwIfError(productResult.error, "product create");
  const product = productResult.data as Row;
  const variants = input.variants?.length
    ? input.variants
    : [{ code: "BASE", name: "Standard", priceMinor: input.basePriceMinor }];
  const variantResult = await database.client.from("product_variants").insert(variants.map((variant, index) => ({
    organization_id: principal.organizationId,
    product_id: String(product.id),
    code: variant.code.trim().toUpperCase(),
    name: variant.name.trim(),
    price_minor: variant.priceMinor,
    sort_order: index
  }))).select("id,organization_id,product_id,code,name,price_minor,sort_order,status");
  if (variantResult.error) {
    await database.client.from("products").delete().eq("id", String(product.id)).eq("organization_id", principal.organizationId);
    throwIfError(variantResult.error, "variant create");
  }
  const availabilityResult = await database.client.from("product_availability").insert(["POS", "QR", "KIOSK", "PICKUP"].map((channel) => ({
    organization_id: principal.organizationId,
    store_id: input.storeId,
    product_id: String(product.id),
    channel,
    is_available: true,
    sold_out: false
  })));
  if (availabilityResult.error) {
    await database.client.from("products").delete().eq("id", String(product.id)).eq("organization_id", principal.organizationId);
    throwIfError(availabilityResult.error, "availability create");
  }
  return mapProduct(
    product,
    ((variantResult.data ?? []) as Row[]).map(mapVariant),
    []
  );
}

export async function createMenu(
  database: Database,
  principal: SessionPrincipal,
  input: CreateMenuInput
): Promise<MenuSummary> {
  const code = codeFrom(input.code ?? "", codeFrom(slugify(input.name).replace(/-/g, "_"), "MENU"));
  const result = await database.client
    .from("menus")
    .insert({
      organization_id: principal.organizationId,
      store_id: input.storeId,
      code,
      name: input.name.trim(),
      channel: input.channel
    })
    .select("id,organization_id,store_id,code,name,channel,status")
    .single();
  throwIfError(result.error, "menu create");
  return mapMenu(result.data as Row);
}

export async function createMenuItem(
  database: Database,
  principal: SessionPrincipal,
  input: CreateMenuItemInput
): Promise<MenuItemSummary> {
  const menuResult = await database.client
    .from("menus")
    .select("id")
    .eq("id", input.menuId)
    .eq("organization_id", principal.organizationId)
    .eq("store_id", input.storeId)
    .maybeSingle();
  throwIfError(menuResult.error, "menu access check");
  if (!menuResult.data) throw new Error("Menu was not found in the selected store");
  const productResult = await database.client
    .from("products")
    .select("id")
    .eq("id", input.productId)
    .eq("organization_id", principal.organizationId)
    .maybeSingle();
  throwIfError(productResult.error, "product access check");
  if (!productResult.data) throw new Error("Product was not found in the organization");
  if (input.variantId) {
    const variantResult = await database.client
      .from("product_variants")
      .select("id")
      .eq("id", input.variantId)
      .eq("product_id", input.productId)
      .eq("organization_id", principal.organizationId)
      .maybeSingle();
    throwIfError(variantResult.error, "variant access check");
    if (!variantResult.data) throw new Error("Variant was not found on the selected product");
  }
  const result = await database.client
    .from("menu_items")
    .insert({
      organization_id: principal.organizationId,
      menu_id: input.menuId,
      product_id: input.productId,
      ...(input.variantId ? { variant_id: input.variantId } : {}),
      ...(input.priceOverrideMinor === undefined ? {} : { price_override_minor: input.priceOverrideMinor })
    })
    .select("id,organization_id,menu_id,product_id,variant_id,price_override_minor,sort_order,is_available,sold_out")
    .single();
  throwIfError(result.error, "menu item create");
  return mapMenuItem(result.data as Row);
}

export async function createModifierGroup(
  database: Database,
  principal: SessionPrincipal,
  input: CreateModifierGroupInput
): Promise<ModifierGroupSummary> {
  const code = codeFrom(input.code ?? "", codeFrom(slugify(input.name).replace(/-/g, "_"), "MODIFIER_GROUP"));
  const minSelections = input.minSelections ?? (input.required ? 1 : 0);
  const maxSelections = input.maxSelections ?? (input.selectionType === "MULTIPLE" ? 99 : 1);
  if (maxSelections < minSelections) throw new Error("Modifier group maxSelections must be greater than or equal to minSelections");
  const groupResult = await database.client
    .from("modifier_groups")
    .insert({
      organization_id: principal.organizationId,
      code,
      name: input.name.trim(),
      selection_type: input.selectionType ?? "SINGLE",
      min_selections: minSelections,
      max_selections: maxSelections,
      required: input.required ?? false
    })
    .select("id,organization_id,code,name,selection_type,min_selections,max_selections,required,status")
    .single();
  throwIfError(groupResult.error, "modifier group create");
  const group = groupResult.data as Row;
  const modifierInputs = input.modifiers ?? [];
  const modifierResult = modifierInputs.length
    ? await database.client.from("modifiers").insert(modifierInputs.map((modifier, index) => ({
      organization_id: principal.organizationId,
      modifier_group_id: String(group.id),
      code: modifier.code.trim().toUpperCase(),
      name: modifier.name.trim(),
      price_delta_minor: modifier.priceDeltaMinor ?? 0,
      sort_order: index
    }))).select("id,organization_id,modifier_group_id,code,name,price_delta_minor,sort_order,status")
    : { data: [], error: null };
  if (modifierResult.error) {
    await database.client.from("modifier_groups").delete().eq("id", String(group.id)).eq("organization_id", principal.organizationId);
    throwIfError(modifierResult.error, "modifier create");
  }
  return mapModifierGroup(group, ((modifierResult.data ?? []) as Row[]).map(mapModifier));
}

export async function updateProduct(
  database: Database,
  principal: SessionPrincipal,
  productId: string,
  input: UpdateProductInput
): Promise<ProductSummary> {
  const patch: Row = {};
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.basePriceMinor !== undefined) patch.base_price_minor = input.basePriceMinor;
  if (input.status !== undefined) patch.status = input.status;
  const result = await database.client
    .from("products")
    .update(patch)
    .eq("id", productId)
    .eq("organization_id", principal.organizationId)
    .select("id,organization_id,category_id,sku,name,description,base_price_minor,currency,status")
    .single();
  throwIfError(result.error, "product update");
  const variantResult = await database.client
    .from("product_variants")
    .select("id,organization_id,product_id,code,name,price_minor,sort_order,status")
    .eq("organization_id", principal.organizationId)
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  throwIfError(variantResult.error, "variant lookup");
  return mapProduct(result.data as Row, ((variantResult.data ?? []) as Row[]).map(mapVariant), []);
}

export async function updateProductAvailability(
  database: Database,
  principal: SessionPrincipal,
  productId: string,
  input: UpdateProductAvailabilityInput
): Promise<ProductAvailabilitySummary> {
  const result = await database.client.rpc(
    "patch_product_availability",
    buildAvailabilityPatchParams(input, principal, productId)
  );
  throwIfError(result.error, "availability update");
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as Row | undefined;
  if (!row) throw new Error("Supabase availability update returned no row");
  return mapAvailability(row);
}

export interface CreateProductModifierGroupInput {
  storeId: string;
  productId: string;
  modifierGroupId: string;
  sortOrder?: number;
}

export async function createProductModifierGroup(
  database: Database,
  principal: SessionPrincipal,
  input: CreateProductModifierGroupInput
): Promise<ProductModifierGroupMapping> {
  const productCheck = await database.client
    .from("products")
    .select("id")
    .eq("id", input.productId)
    .eq("organization_id", principal.organizationId)
    .maybeSingle();
  throwIfError(productCheck.error, "product check");
  if (!productCheck.data) throw new Error("Product was not found in the organization");
  const groupCheck = await database.client
    .from("modifier_groups")
    .select("id")
    .eq("id", input.modifierGroupId)
    .eq("organization_id", principal.organizationId)
    .maybeSingle();
  throwIfError(groupCheck.error, "modifier group check");
  if (!groupCheck.data) throw new Error("Modifier group was not found in the organization");
  const result = await database.client
    .from("product_modifier_groups")
    .upsert({
      organization_id: principal.organizationId,
      product_id: input.productId,
      modifier_group_id: input.modifierGroupId,
      sort_order: input.sortOrder ?? 0
    }, { onConflict: "organization_id,product_id,modifier_group_id" })
    .select("organization_id,product_id,modifier_group_id,sort_order")
    .single();
  throwIfError(result.error, "product modifier group create");
  const row = result.data as Row;
  return {
    productId: String(row.product_id),
    modifierGroupId: String(row.modifier_group_id),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

export async function deleteProductModifierGroup(
  database: Database,
  principal: SessionPrincipal,
  productId: string,
  modifierGroupId: string
): Promise<void> {
  const result = await database.client
    .from("product_modifier_groups")
    .delete()
    .eq("organization_id", principal.organizationId)
    .eq("product_id", productId)
    .eq("modifier_group_id", modifierGroupId);
  throwIfError(result.error, "product modifier group delete");
}

export interface StoreByCodeRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  currency: string;
  status: string;
}

export async function getStoreByCode(
  database: Database,
  storeCode: string
): Promise<StoreByCodeRecord | null> {
  const result = await database.client
    .from("stores")
    .select("id,organization_id,code,name,currency,status")
    .eq("code", storeCode.trim().toUpperCase())
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as Row;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    code: String(row.code),
    name: String(row.name),
    currency: String(row.currency ?? "THB"),
    status: String(row.status)
  };
}

export async function getPublicCatalog(
  database: Database,
  storeCode: string,
  channel: CatalogChannel = "QR"
): Promise<PublicCatalogSnapshot | null> {
  const store = await getStoreByCode(database, storeCode);
  if (!store || store.status !== "ACTIVE") return null;

  const catalog = await listCatalog(
    database,
    { organizationId: store.organizationId } as SessionPrincipal,
    store.id
  );

  const productModMap = new Map<string, string[]>();
  for (const mapping of catalog.productModifierGroups) {
    const list = productModMap.get(mapping.productId) ?? [];
    list.push(mapping.modifierGroupId);
    productModMap.set(mapping.productId, list);
  }

  const activeCategories: PublicCatalogCategory[] = catalog.categories
    .filter((c) => c.status === "ACTIVE")
    .map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const modifierGroupMap = new Map(catalog.modifierGroups.map((g) => [g.id, g]));

  const publicProducts: PublicProductItem[] = [];
  for (const product of catalog.products) {
    if (product.status !== "ACTIVE") continue;
    const avail = product.availability.find((a) => a.channel === channel);
    if (!avail || !avail.isAvailable) continue;

    const attachedGroupIds = productModMap.get(product.id) ?? [];
    const attachedGroups = attachedGroupIds
      .map((id) => modifierGroupMap.get(id))
      .filter((g): g is ModifierGroupSummary => g !== undefined && g.status === "ACTIVE")
      .map((g) => ({
        ...g,
        modifiers: g.modifiers.filter((m) => m.status === "ACTIVE")
      }));

    publicProducts.push({
      id: product.id,
      ...(product.categoryId === undefined ? {} : { categoryId: product.categoryId }),
      name: product.name,
      description: product.description,
      basePriceMinor: product.basePriceMinor,
      effectivePriceMinor: avail.priceOverrideMinor ?? product.basePriceMinor,
      currency: product.currency,
      soldOut: avail.soldOut,
      variants: product.variants.filter((v) => v.status === "ACTIVE"),
      modifierGroups: attachedGroups
    });
  }

  return {
    store: {
      id: store.id,
      code: store.code,
      name: store.name,
      currency: store.currency
    },
    channel,
    categories: activeCategories,
    products: publicProducts
  };
}

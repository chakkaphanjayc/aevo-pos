import { expect, test } from "bun:test";
import { buildAvailabilityPatchParams, slugifyCatalogName, validateCatalogChannel } from "../src";

test("catalog slugs are stable and support non-Latin names", () => {
  expect(slugifyCatalogName("Coffee & Tea")).toBe("coffee-tea");
  expect(slugifyCatalogName("กาแฟร้อน")).toMatch(/^item-[a-z0-9]+$/);
  expect(slugifyCatalogName("กาแฟร้อน")).toBe(slugifyCatalogName("กาแฟร้อน"));
});

test("catalog channels accept only supported storefront channels", () => {
  expect(validateCatalogChannel("POS")).toBeTrue();
  expect(validateCatalogChannel("KIOSK")).toBeTrue();
  expect(validateCatalogChannel("UNKNOWN")).toBeFalse();
});

test("availability patches preserve fields omitted by the caller", () => {
  const values = buildAvailabilityPatchParams(
    { storeId: "store", channel: "POS", soldOut: true },
    { organizationId: "org" } as never,
    "product"
  );
  expect(values).toMatchObject({
    p_organization_id: "org",
    p_store_id: "store",
    p_product_id: "product",
    p_channel: "POS",
    p_is_available: null,
    p_is_available_set: false,
    p_sold_out: true,
    p_sold_out_set: true,
    p_price_override_minor: null,
    p_price_override_set: false
  });
});

test("availability PATCH can explicitly clear a price override", () => {
  const values = buildAvailabilityPatchParams(
    { storeId: "store", channel: "POS", priceOverrideMinor: null },
    { organizationId: "org" } as never,
    "product"
  );
  expect(values).toMatchObject({
    p_price_override_minor: null,
    p_price_override_set: true
  });
});

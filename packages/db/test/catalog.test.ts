import { expect, test } from "bun:test";
import { mergeAvailabilityValues, slugifyCatalogName, validateCatalogChannel } from "../src";

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
  const values = mergeAvailabilityValues(
    { is_available: false, sold_out: false, price_override_minor: 7200 },
    { storeId: "store", channel: "POS", soldOut: true },
    { organizationId: "org" } as never,
    "product"
  );
  expect(values).toMatchObject({
    organization_id: "org",
    store_id: "store",
    product_id: "product",
    channel: "POS",
    is_available: false,
    sold_out: true,
    price_override_minor: 7200
  });
});

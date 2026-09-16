import { expect, test } from "bun:test";
import { slugifyCatalogName, validateCatalogChannel } from "../src";

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

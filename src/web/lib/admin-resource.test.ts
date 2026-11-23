import { expect, test } from "bun:test";

import { ADMIN_QUERY_ROOT, adminResourceQueryKey } from "./admin-resource.ts";

const loadSystem = async () => await Promise.resolve({ ok: true });
const loadGrants = async () => await Promise.resolve({ ok: true });
const sameSystemLoaderOnTheNextRender = async () => await Promise.resolve({ ok: true });
const otherLoader = async () => await Promise.resolve({ ok: true });

test("two renders of a page with the same resource id share one key", () => {
  expect(adminResourceQueryKey(loadSystem, undefined, "system")).toEqual(
    adminResourceQueryKey(sameSystemLoaderOnTheNextRender, undefined, "system"),
  );
});

test("different resources keep different keys", () => {
  expect(adminResourceQueryKey(loadSystem, undefined, "system")).not.toEqual(
    adminResourceQueryKey(loadGrants, undefined, "grants"),
  );
});

test("without a resource id the loader identity stays the fallback", () => {
  expect(adminResourceQueryKey(loadSystem)).toEqual(adminResourceQueryKey(loadSystem));
  expect(adminResourceQueryKey(loadSystem)).not.toEqual(adminResourceQueryKey(otherLoader));
});

test("an explicit query key carries the page's filters", () => {
  expect(adminResourceQueryKey(loadSystem, ["audit", "suspend", 2], "system")).toEqual([
    ADMIN_QUERY_ROOT,
    "audit",
    "suspend",
    2,
  ]);
});

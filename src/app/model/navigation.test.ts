import { describe, expect, test } from "bun:test";
import { restoreOpenSections } from "./navigation";

describe("restoreOpenSections", () => {
  test("restores valid unique app tabs in their saved order", () => {
    expect(restoreOpenSections('["tasks","chat","tasks","settings"]')).toEqual([
      "tasks",
      "chat",
      "settings",
    ]);
  });

  test("ignores unknown tabs and recovers from invalid storage", () => {
    expect(restoreOpenSections('["tasks","unknown"]')).toEqual(["tasks"]);
    expect(restoreOpenSections("not-json")).toEqual(["dashboard"]);
    expect(restoreOpenSections("[]")).toEqual(["dashboard"]);
  });
});

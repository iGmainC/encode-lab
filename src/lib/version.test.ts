import { describe, expect, test } from "bun:test";
import { isNewerReleaseVersion, normalizeReleaseVersion } from "./version";

describe("release version compare", () => {
  test("accepts stable and beta tags", () => {
    expect(normalizeReleaseVersion("v10.0.0")).toBe("10.0.0");
    expect(normalizeReleaseVersion("v10.0.0-beta")).toBe("10.0.0-beta");
  });

  test("rejects versions outside release tag rules", () => {
    expect(normalizeReleaseVersion("v10.0")).toBeNull();
    expect(normalizeReleaseVersion("v10.0.0-alpha")).toBeNull();
  });

  test("compares major versions numerically", () => {
    expect(isNewerReleaseVersion("v10.0.0", "v9.99.99")).toBe(true);
  });

  test("treats stable release as newer than same beta", () => {
    expect(isNewerReleaseVersion("v10.0.0", "v10.0.0-beta")).toBe(true);
  });
});

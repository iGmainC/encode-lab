import { describe, expect, test } from "bun:test";
import { hasExecutionSettingsChanges } from "./SettingsPage";
import type { AppSettings } from "../types/workbench";

/** 构造执行设置快照，确保测试保留未开放编辑的兼容字段。 */
function buildSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    concurrencyN: 2,
    ffmpegStrategy: "bundled",
    defaultOutputDir: "/tmp/output",
    thumbnailMode: "imagePath",
    ...overrides,
  };
}

describe("execution settings changes", () => {
  test("detects concurrency and default output directory changes", () => {
    const persisted = buildSettings();

    expect(hasExecutionSettingsChanges(persisted, buildSettings({ concurrencyN: 4 }))).toBe(true);
    expect(hasExecutionSettingsChanges(persisted, buildSettings({ defaultOutputDir: "/tmp/new" }))).toBe(true);
  });

  test("ignores fields that remain read-only on the settings page", () => {
    const persisted = buildSettings();
    const draft = buildSettings({ ffmpegStrategy: "system", thumbnailMode: "local" });

    expect(hasExecutionSettingsChanges(persisted, draft)).toBe(false);
  });

  test("does not enable saving before both snapshots are ready", () => {
    expect(hasExecutionSettingsChanges(null, buildSettings())).toBe(false);
    expect(hasExecutionSettingsChanges(buildSettings(), null)).toBe(false);
  });
});

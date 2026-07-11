import { describe, expect, test } from "bun:test";
import type { TaskDraftSnapshot } from "../types/workbench";
import { buildOutputFileNamePreview, sanitizeOutputFileStem } from "./mediaFormat";

/** 构造输出命名测试使用的最小任务快照。 */
function buildSnapshot(overrides: Partial<TaskDraftSnapshot> = {}): TaskDraftSnapshot {
  return {
    name: "preview-draft",
    video: {
      codecFormat: "h265",
      encoder: "libx265",
      bitrateMode: "CRF",
      crf: 23,
      enableTwoPass: false,
    },
    audio: { mode: "copy" },
    container: { format: "mp4", faststart: true },
    output: {
      dir: "/tmp",
      fileNamePattern: "{inputName}_{taskName}",
      overwrite: "autoRename",
    },
    ...overrides,
  };
}

describe("output file name preview", () => {
  test("matches backend sanitization and exposes dynamic suffix placeholders", () => {
    const snapshot = buildSnapshot({
      name: "测试*任务",
      container: { format: "mkv" },
      output: {
        dir: "/tmp",
        fileNamePattern: "{inputName}:{taskName}/?",
        overwrite: "autoRename",
      },
    });

    expect(buildOutputFileNamePreview("/tmp/Core Universe (4K).mov", snapshot)).toEqual({
      sanitizedStem: "Core Universe (4K)_测试_任务_",
      displayName: "Core Universe (4K)_测试_任务_-<job-id:8>[-N].mkv",
    });
  });

  test("matches backend boundary-dot cleanup and only removes the final normal extension", () => {
    expect(buildOutputFileNamePreview("/tmp/.source", buildSnapshot()).sanitizedStem).toBe(
      "source_preview-draft",
    );
    expect(buildOutputFileNamePreview("/tmp/archive.tar.mov", buildSnapshot()).sanitizedStem).toBe(
      "archive.tar_preview-draft",
    );
    expect(buildOutputFileNamePreview("", buildSnapshot()).sanitizedStem).toBe(
      "input_preview-draft",
    );
  });

  test("uses the same empty-stem fallback as the backend", () => {
    expect(sanitizeOutputFileStem("../..\\\n")).toBe("encode-lab-output");
  });
});

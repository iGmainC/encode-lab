import { expect, test } from "bun:test";
import type { TaskDraftSnapshot } from "../types/workbench";
import { buildDetachedPreviewPayload } from "./detachedPreview";

/** 独立预览契约测试使用的最小任务快照。 */
const snapshot: TaskDraftSnapshot = {
  name: "preview",
  video: {
    codecFormat: "h265",
    encoder: "libx265",
    bitrateMode: "CRF",
    crf: 23,
    enableTwoPass: false,
  },
  audio: { mode: "copy" },
  container: { format: "mkv" },
  output: {
    dir: "/tmp",
    fileNamePattern: "{inputName}_{taskName}",
    overwrite: "autoRename",
  },
};

test("detached preview payload preserves source fps for the timeline end guard", () => {
  const payload = buildDetachedPreviewPayload(
    {
      sourceFile: "/tmp/input.mkv",
      sourceDurationSec: 60,
      sourceFps: 12,
      taskDraftSnapshot: snapshot,
      splitMode: "vertical",
      splitterPosition: 0.5,
      compareOrder: "source-first",
    },
    () => 123,
  );

  expect(payload.sourceFps).toBe(12);
  expect(payload.updatedAt).toBe(123);
});

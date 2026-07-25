import { expect, test } from "bun:test";
import type { TaskDraftSnapshot } from "../types/workbench";
import {
  buildDetachedPreviewPayload,
  resolveDetachedPreviewPayload,
  selectLatestDetachedPreviewPayload,
} from "./detachedPreview";

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
      framePinId: "pin-1",
    },
    () => 123,
  );

  expect(payload.sourceFps).toBe(12);
  expect(payload.framePinId).toBe("pin-1");
  expect(payload.updatedAt).toBeGreaterThanOrEqual(123);
});

test("detached preview payload timestamp stays monotonic within the same millisecond", () => {
  const first = buildDetachedPreviewPayload(
    {
      sourceFile: "/tmp/first.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical",
      splitterPosition: 0.5,
    },
    () => 500,
  );
  const second = buildDetachedPreviewPayload(
    {
      sourceFile: "/tmp/second.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical",
      splitterPosition: 0.5,
    },
    () => 500,
  );

  expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
});

test("detached preview keeps the newest payload when initial loading races with events", () => {
  const older = buildDetachedPreviewPayload(
    {
      sourceFile: "/tmp/older.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical",
      splitterPosition: 0.5,
    },
    () => 100,
  );
  const newer = buildDetachedPreviewPayload(
    {
      sourceFile: "/tmp/newer.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical",
      splitterPosition: 0.5,
    },
    () => 200,
  );

  expect(selectLatestDetachedPreviewPayload(newer, older).sourceFile).toBe("/tmp/newer.mkv");
  expect(selectLatestDetachedPreviewPayload(older, newer).sourceFile).toBe("/tmp/newer.mkv");
});

test("detached preview releases a pin carried only by a rejected stale payload", () => {
  const current = {
    ...buildDetachedPreviewPayload({
      sourceFile: "/tmp/current.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical" as const,
      splitterPosition: 0.5,
      framePinId: "pin-current",
    }),
    updatedAt: 200,
  };
  const stale = {
    ...buildDetachedPreviewPayload({
      sourceFile: "/tmp/stale.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical" as const,
      splitterPosition: 0.5,
      framePinId: "pin-stale",
    }),
    updatedAt: 100,
  };

  const selection = resolveDetachedPreviewPayload(current, stale);

  expect(selection.payload).toBe(current);
  expect(selection.rejectedFramePinId).toBe("pin-stale");
});

test("detached preview never releases the pin still held by the selected payload", () => {
  const current = {
    ...buildDetachedPreviewPayload({
      sourceFile: "/tmp/current.mkv",
      taskDraftSnapshot: snapshot,
      splitMode: "vertical" as const,
      splitterPosition: 0.5,
      framePinId: "pin-shared",
    }),
    updatedAt: 200,
  };
  const duplicate = { ...current };

  const selection = resolveDetachedPreviewPayload(current, duplicate);

  expect(selection.payload).toBe(current);
  expect(selection.rejectedFramePinId).toBeUndefined();
});

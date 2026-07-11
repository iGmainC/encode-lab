import { describe, expect, test } from "bun:test";
import {
  advanceSourceSelection,
  resolveClipRangeAfterMetadataRefresh,
  resolveDolbyVisionAudioMode,
  resolveDolbyVisionPreservationAfterMetadata,
} from "./TaskDraftContext";
import type { VideoMetadataResult } from "../types/workbench";

describe("task draft source selection", () => {
  test("advances the selection revision when the same source path is selected again", () => {
    const current = { path: "/tmp/source.mov", revision: 4 };

    expect(advanceSourceSelection(current, "/tmp/source.mov")).toEqual({
      path: "/tmp/source.mov",
      revision: 5,
    });
  });

  test("preserves clip inputs while metadata for a selected source is pending", () => {
    expect(resolveClipRangeAfterMetadataRefresh({
      sourceFilePath: "/tmp/source.mov",
      durationSec: undefined,
      currentStartSec: 12,
      currentEndSec: 42,
    })).toBeNull();
  });

  test("clamps preserved clip inputs after refreshed metadata arrives", () => {
    expect(resolveClipRangeAfterMetadataRefresh({
      sourceFilePath: "/tmp/source.mov",
      durationSec: 30,
      currentStartSec: 12,
      currentEndSec: 42,
    })).toEqual({ startSec: 12, endSec: 30 });
  });
});

describe("Dolby Vision audio normalization", () => {
  test("forces audio copy for the preservation pipeline", () => {
    expect(resolveDolbyVisionAudioMode(true, "custom")).toBe("copy");
  });

  test("keeps the requested mode outside the preservation pipeline", () => {
    expect(resolveDolbyVisionAudioMode(false, "custom")).toBe("custom");
  });

  test("keeps preservation through a same-path Dolby Vision metadata refresh", () => {
    const metadata = {
      inputFile: "/tmp/source.mov",
      video: { hdrType: "DolbyVision" },
      tags: [],
    } satisfies VideoMetadataResult;

    expect(resolveDolbyVisionPreservationAfterMetadata(true, metadata)).toBe(true);
  });

  test("disables preservation as soon as refreshed metadata confirms a non-DV source", () => {
    const metadata = {
      inputFile: "/tmp/source.mov",
      video: { hdrType: "Hdr10" },
      tags: [],
    } satisfies VideoMetadataResult;

    expect(resolveDolbyVisionPreservationAfterMetadata(true, metadata)).toBe(false);
  });
});

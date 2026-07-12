import { describe, expect, test } from "bun:test";
import type { TaskDraftSnapshot, VideoMetadataResult } from "../types/workbench";
import { buildWorkbenchValidationIssues } from "./workbenchPolicy";

/** 构造可执行的基础任务快照，测试只覆盖色彩安全策略。 */
function buildSnapshot(): TaskDraftSnapshot {
  return {
    name: "test",
    video: {
      codecFormat: "h265",
      encoder: "libx265",
      bitrateMode: "CRF",
      crf: 23,
      pixelFormat: "yuv420p10le",
      enableTwoPass: false,
    },
    audio: { mode: "copy" },
    container: { format: "mkv" },
    advancedArgs: "-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc",
    output: {
      dir: "/tmp",
      fileNamePattern: "{inputName}_{taskName}",
      overwrite: "autoRename",
    },
  };
}

/** 构造最小视频元数据。 */
function buildMetadata(hdrType: NonNullable<VideoMetadataResult["video"]>["hdrType"]): VideoMetadataResult {
  return {
    inputFile: "/tmp/input.mkv",
    video: {
      codecName: "hevc",
      width: 3840,
      height: 2160,
      fps: 24,
      bitDepth: 10,
      pixFmt: "yuv420p10le",
      hdrType,
    },
    tags: [],
  };
}

/** 只返回色彩相关问题 id，避免基础校验噪声影响断言。 */
function getColorIssueIds(metadata: VideoMetadataResult, snapshot: TaskDraftSnapshot) {
  return buildWorkbenchValidationIssues({
    sourceFilePath: metadata.inputFile,
    metadata,
    snapshot,
    ffmpegProbe: null,
  })
    .filter((issue) => issue.tab === "color")
    .map((issue) => issue.id);
}

/** 返回完整问题 id，覆盖数值、截取和 Copy 语义。 */
function getIssueIds(metadata: VideoMetadataResult, snapshot: TaskDraftSnapshot) {
  return buildWorkbenchValidationIssues({
    sourceFilePath: metadata.inputFile,
    metadata,
    snapshot,
    ffmpegProbe: null,
  }).map((issue) => issue.id);
}

describe("workbench HDR output policy", () => {
  test("blocks 8-bit and BT.709 relabeling for HDR10 re-encode", () => {
    const snapshot = buildSnapshot();
    snapshot.video.pixelFormat = "yuv420p";
    snapshot.advancedArgs = "-color_primaries bt709 -color_trc bt709 -colorspace bt709";

    expect(getColorIssueIds(buildMetadata("Hdr10"), snapshot)).toEqual([
      "hdr-bit-depth",
      "hdr-color-tags",
    ]);
  });

  test("accepts a 10-bit BT.2020 PQ HDR10 output", () => {
    expect(getColorIssueIds(buildMetadata("Hdr10"), buildSnapshot())).toEqual([]);
  });

  test("blocks Profile 5 re-encode when RPU preservation is disabled", () => {
    const metadata = buildMetadata("DolbyVision");
    if (!metadata.video) throw new Error("video fixture missing");
    metadata.video.dolbyVisionProfile = 5;
    metadata.video.dolbyVisionCompatibilityId = 0;

    expect(getColorIssueIds(metadata, buildSnapshot())).toEqual(["dolby-vision-profile-5-output"]);
  });

  test("accepts Profile 5 when the dedicated preservation path is enabled", () => {
    const metadata = buildMetadata("DolbyVision");
    if (!metadata.video) throw new Error("video fixture missing");
    metadata.video.dolbyVisionProfile = 5;
    metadata.video.dolbyVisionCompatibilityId = 0;
    const snapshot = buildSnapshot();
    snapshot.video.preserveDolbyVisionMetadata = true;

    expect(getColorIssueIds(metadata, snapshot)).toEqual([]);
  });

  test("rejects custom audio in the Dolby Vision preservation path", () => {
    const metadata = buildMetadata("DolbyVision");
    const snapshot = buildSnapshot();
    snapshot.video.preserveDolbyVisionMetadata = true;
    snapshot.audio = { mode: "custom", customArgs: "-c:a aac" };

    expect(getIssueIds(metadata, snapshot)).toContain("dolby-vision-audio-mode");
  });

  test("allows Profile 8.1 MP4 with common copied audio while preserving the Atmos bitstream", () => {
    const metadata = buildMetadata("DolbyVision");
    if (!metadata.video) throw new Error("video fixture missing");
    metadata.video.dolbyVisionProfile = 8;
    metadata.video.dolbyVisionCompatibilityId = 1;
    metadata.audioTracks = [
      { codecName: "eac3", channels: 6 },
      { codecName: "flac", channels: 2 },
      { codecName: "alac", channels: 2 },
      { codecName: "mp3", channels: 2 },
      { codecName: "opus", channels: 2 },
    ];
    const snapshot = buildSnapshot();
    snapshot.video.preserveDolbyVisionMetadata = true;
    snapshot.container = { format: "mp4", faststart: true };

    expect(getIssueIds(metadata, snapshot)).not.toContain("dolby-vision-mp4-audio");
    expect(getIssueIds(metadata, snapshot)).not.toContain("dolby-vision-mp4-profile");
  });

  test("blocks MP4 when another source track is TrueHD Atmos or PGS", () => {
    const metadata = buildMetadata("DolbyVision");
    if (!metadata.video) throw new Error("video fixture missing");
    metadata.video.dolbyVisionProfile = 8;
    metadata.video.dolbyVisionCompatibilityId = 1;
    metadata.audioTracks = [{ codecName: "eac3" }, { codecName: "truehd" }];
    metadata.auxiliaryStreams = [{ streamType: "subtitle", codecName: "hdmv_pgs_subtitle" }];
    const snapshot = buildSnapshot();
    snapshot.video.preserveDolbyVisionMetadata = true;
    snapshot.container = { format: "mp4" };

    expect(getIssueIds(metadata, snapshot)).toEqual(expect.arrayContaining([
      "dolby-vision-mp4-audio",
      "dolby-vision-mp4-auxiliary",
    ]));
  });

  test("allows stream copy because it does not re-encode the HDR signal", () => {
    const snapshot = buildSnapshot();
    snapshot.video.codecFormat = "copy";
    snapshot.video.encoder = "copy";
    snapshot.video.crf = undefined;
    snapshot.video.preset = undefined;
    snapshot.video.pixelFormat = undefined;
    snapshot.advancedArgs = undefined;

    expect(getColorIssueIds(buildMetadata("Hdr10"), snapshot)).toEqual([]);
  });
});

describe("workbench parameter boundary policy", () => {
  test("rejects non-finite resolution and fps values", () => {
    const snapshot = buildSnapshot();
    snapshot.video.resolution = { width: Number.NaN, height: 1080 };
    snapshot.video.fps = Number.NaN;

    expect(getIssueIds(buildMetadata("Sdr"), snapshot)).toEqual(
      expect.arrayContaining(["resolution", "fps"]),
    );
  });

  test("rejects an inverted clip range instead of falling back to full duration", () => {
    const metadata = buildMetadata("Sdr");
    metadata.durationSec = 60;
    const snapshot = buildSnapshot();
    snapshot.clipRange = { startMs: 10_000, endMs: 5_000 };

    expect(getIssueIds(metadata, snapshot)).toContain("clip-range");
  });

  test("rejects stale metadata from a previous source", () => {
    const metadata = buildMetadata("Sdr");
    metadata.inputFile = "/tmp/old-source.mkv";

    const issues = buildWorkbenchValidationIssues({
      sourceFilePath: "/tmp/new-source.mkv",
      metadata,
      snapshot: buildSnapshot(),
      ffmpegProbe: null,
    });
    expect(issues.map((issue) => issue.id)).toContain("source-metadata");
  });

  test("rejects re-encode parameters mixed into stream copy", () => {
    const snapshot = buildSnapshot();
    snapshot.video.codecFormat = "copy";

    expect(getIssueIds(buildMetadata("Sdr"), snapshot)).toEqual(
      expect.arrayContaining(["copy-encoder", "copy-video-parameters"]),
    );
  });

  test("rejects malformed CBR rate values", () => {
    const snapshot = buildSnapshot();
    snapshot.video.bitrateMode = "CBR";
    snapshot.video.crf = undefined;
    snapshot.advancedArgs = "-b:v not-a-number -maxrate 7000k -bufsize 10000k";

    expect(getIssueIds(buildMetadata("Sdr"), snapshot)).toContain("bitrate");
  });
});

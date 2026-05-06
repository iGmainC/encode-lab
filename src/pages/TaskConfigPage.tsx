import { useEffect } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { SourceVideoCard } from "../components/workbench/SourceVideoCard";
import { StepFlowHeader } from "../components/workbench/StepFlowHeader";
import { TaskSummaryCard } from "../components/workbench/TaskSummaryCard";
import { useTaskDraft } from "../context/TaskDraftContext";
import type { EncoderCapability, FfmpegProbeResult } from "../types/workbench";

type Props = {
  filteredEncoders: EncoderCapability[];
  selectedEncoderCapability?: EncoderCapability;
  ffmpegProbe: FfmpegProbeResult | null;
  onGoPreview: () => void;
};

/**
 * 生成 Dolby Vision 元数据保留能力的用户可读说明。
 * @param params 当前源视频、编码器和 FFmpeg 探测状态
 * @returns 开关说明与禁用原因；禁用原因为空表示当前允许开启
 */
function buildDolbyVisionPreserveCopy({
  isDolbyVisionSource,
  formCodec,
  formEncoder,
  ffmpegProbe,
}: {
  isDolbyVisionSource: boolean;
  formCodec: string;
  formEncoder: string;
  ffmpegProbe: FfmpegProbeResult | null;
}) {
  if (!isDolbyVisionSource) {
    return {
      hint: "仅当源视频识别为 Dolby Vision 时显示该能力。",
      disabledReason: "当前源视频未被识别为 Dolby Vision。",
    };
  }

  if (!ffmpegProbe) {
    return {
      hint: "正在等待 FFmpeg 能力探测结果，探测完成后会显示是否可保留。",
      disabledReason: "FFmpeg 能力尚未完成探测。",
    };
  }

  if (!ffmpegProbe.ffmpegFound) {
    return {
      hint: "当前环境未找到 ffmpeg，无法确认或执行 Dolby Vision 元数据保留链路。",
      disabledReason: "未找到 ffmpeg。",
    };
  }

  if (!ffmpegProbe.dolbyVision.supportsDoviRpu) {
    return {
      hint: "当前 FFmpeg 未提供 dovi_rpu bitstream filter，无法提取/写回 Dolby Vision RPU 元数据。",
      disabledReason: "缺少 dovi_rpu bitstream filter。",
    };
  }

  if (!ffmpegProbe.dolbyVision.supportsDolbyVisionEncode) {
    return {
      hint: "当前 libx265 未暴露 Dolby Vision 编码参数，无法在输出 H.265 中写入 Dolby Vision 元数据。",
      disabledReason: "libx265 不支持 Dolby Vision 编码参数。",
    };
  }

  if (formCodec !== "h265" || formEncoder !== "libx265") {
    return {
      hint: "当前版本仅支持 H.265 + libx265 的 Dolby Vision 保留实验链路。",
      disabledReason: `当前选择为 ${formCodec} / ${formEncoder}，请切换到 H.265 / libx265。`,
    };
  }

  return {
    hint: "尽量沿用源片的 Dolby Vision 相关色彩与元数据能力，实际结果仍取决于 FFmpeg 与编码器支持。",
    disabledReason: "",
  };
}

export function TaskConfigPage({
  filteredEncoders,
  selectedEncoderCapability,
  ffmpegProbe,
  onGoPreview,
}: Props) {
  const {
    step,
    setStep,
    formCodec,
    setFormCodec,
    formEncoder,
    setFormEncoder,
    formMode,
    setFormMode,
    formTwoPass,
    setFormTwoPass,
    formCrf,
    setFormCrf,
    formPreset,
    setFormPreset,
    keepOriginalResolution,
    setKeepOriginalResolution,
    keepOriginalFps,
    setKeepOriginalFps,
    preserveDolbyVisionMetadata,
    setPreserveDolbyVisionMetadata,
    formWidth,
    setFormWidth,
    formHeight,
    setFormHeight,
    formFps,
    setFormFps,
    formBitrateKbps,
    setFormBitrateKbps,
    formMaxrateKbps,
    setFormMaxrateKbps,
    formBufsizeKbps,
    setFormBufsizeKbps,
    formPixelFormat,
    setFormPixelFormat,
    formColorPrimaries,
    setFormColorPrimaries,
    formColorTrc,
    setFormColorTrc,
    formColorspace,
    setFormColorspace,
    av1CpuUsed,
    setAv1CpuUsed,
    av1RowMt,
    setAv1RowMt,
    av1TileColumns,
    setAv1TileColumns,
    av1TileRows,
    setAv1TileRows,
    av1SvtTune,
    setAv1SvtTune,
    av1FilmGrain,
    setAv1FilmGrain,
    containerFormat,
    setContainerFormat,
    containerFaststart,
    setContainerFaststart,
    sourceFilePath,
    setSourceFilePath,
    videoMetadata,
    videoMetadataLoading,
    videoMetadataError,
    isDragOverWindow,
    pickSourceFile,
    retryVideoMetadata,
  } = useTaskDraft();

  const isDolbyVisionSource = videoMetadata?.video?.hdrType === "DolbyVision";
  const dolbyVisionCopy = buildDolbyVisionPreserveCopy({
    isDolbyVisionSource,
    formCodec,
    formEncoder,
    ffmpegProbe,
  });
  const canPreserveDolbyVision =
    isDolbyVisionSource &&
    formCodec === "h265" &&
    formEncoder === "libx265" &&
    Boolean(ffmpegProbe?.dolbyVision.supportsPreservePipeline);

  useEffect(() => {
    if (!canPreserveDolbyVision && preserveDolbyVisionMetadata) {
      setPreserveDolbyVisionMetadata(false);
    }
  }, [canPreserveDolbyVision, preserveDolbyVisionMetadata, setPreserveDolbyVisionMetadata]);

  const presetHint =
    formPreset === ""
      ? "当前编码器通常不提供 preset 档位。"
      : formPreset === "ultrafast" || formPreset === "superfast" || formPreset === "veryfast"
        ? "偏速度：编码更快，体积通常更大。"
        : formPreset === "medium" || formPreset === "fast" || formPreset === "slow"
          ? "均衡档：速度与压缩效率平衡，推荐先从这里开始。"
          : "偏质量/压缩：编码更慢，体积通常更小。";

  const isAv1SoftwareEncoder = formEncoder === "libaom-av1" || formEncoder === "svtav1";

  return (
    <div className="space-y-6">
      <StepFlowHeader currentStep={step} />

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-6">
          <SourceVideoCard
            sourceFilePath={sourceFilePath}
            setSourceFilePath={setSourceFilePath}
            videoMetadata={videoMetadata}
            videoMetadataLoading={videoMetadataLoading}
            videoMetadataError={videoMetadataError}
            onRetry={() => void retryVideoMetadata()}
            onPickSourceFile={() => void pickSourceFile()}
            isDragOverWindow={isDragOverWindow}
          />
          <TaskSummaryCard
            videoMetadata={videoMetadata}
            codec={formCodec}
            encoder={formEncoder}
            mode={formMode}
            twoPass={formTwoPass}
            preserveDolbyVisionMetadata={preserveDolbyVisionMetadata}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>参数面板</CardTitle>
            <CardDescription>右侧固定承载视频、音频、容器和高级参数。优先保持信息密度和可连续调参体验。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Codec</span>
                <Select value={formCodec} onValueChange={setFormCodec}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Codec" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="h264">H.264</SelectItem>
                    <SelectItem value="h265">H.265</SelectItem>
                    <SelectItem value="av1">AV1</SelectItem>
                    <SelectItem value="vp9">VP9</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Encoder</span>
                <Select value={formEncoder} onValueChange={setFormEncoder}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Encoder" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredEncoders.map((item) => (
                      <SelectItem key={item.encoder} value={item.encoder}>
                        {item.displayName} {item.available ? "" : "(不可用)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Bitrate Mode</span>
                <Select
                  value={formMode}
                  onValueChange={(value) => {
                    setFormMode(value as "CRF" | "CBR" | "ABR");
                    setStep("config");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择码率模式" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedEncoderCapability?.supportsCrf ? <SelectItem value="CRF">CRF</SelectItem> : null}
                    <SelectItem value="CBR">CBR</SelectItem>
                    <SelectItem value="ABR">ABR</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Two-pass</span>
                <Select
                  value={formTwoPass ? "yes" : "no"}
                  onValueChange={(value) => setFormTwoPass(value === "yes")}
                  disabled={!selectedEncoderCapability?.supportsTwoPass}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 2-pass" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">关闭</SelectItem>
                    <SelectItem value="yes">开启</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            {formMode === "CRF" ? (
              <Card className="border-dashed shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">CRF 质量</span>
                    <span className="font-medium">{formCrf}</span>
                  </div>
                  <Slider
                    min={0}
                    max={51}
                    step={1}
                    value={[formCrf]}
                    onValueChange={(value) => setFormCrf(value[0] ?? 23)}
                    disabled={!selectedEncoderCapability?.supportsCrf}
                  />
                  <p className="text-xs text-muted-foreground">数值越低质量越高，体积通常更大。</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">目标码率</span>
                  <input
                    className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                    value={formBitrateKbps}
                    onChange={(event) => setFormBitrateKbps(event.target.value)}
                    placeholder="5000"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">maxrate</span>
                  <input
                    className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                    value={formMaxrateKbps}
                    onChange={(event) => setFormMaxrateKbps(event.target.value)}
                    placeholder="7000"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">bufsize</span>
                  <input
                    className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                    value={formBufsizeKbps}
                    onChange={(event) => setFormBufsizeKbps(event.target.value)}
                    placeholder="10000"
                  />
                </label>
              </div>
            )}

            {formCodec === "av1" ? (
              <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">AV1 高级参数</div>
                    <p className="text-xs text-muted-foreground">
                      根据当前 AV1 编码器生成软件编码高级参数，并追加到 advancedArgs。
                    </p>
                  </div>
                  <div className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                    {isAv1SoftwareEncoder ? "软件编码" : "硬件编码"}
                  </div>
                </div>

                {formEncoder === "libaom-av1" ? (
                  <div className="grid gap-4 md:grid-cols-4">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">cpu-used</span>
                      <Select value={av1CpuUsed} onValueChange={setAv1CpuUsed}>
                        <SelectTrigger>
                          <SelectValue placeholder="选择速度档" />
                        </SelectTrigger>
                        <SelectContent>
                          {["0", "1", "2", "3", "4", "5", "6", "7", "8"].map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">越高越快，压缩效率通常越低。</p>
                    </label>

                    <div className="rounded-2xl border bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">row-mt</div>
                          <p className="text-xs text-muted-foreground">启用行级多线程。</p>
                        </div>
                        <Switch checked={av1RowMt} onCheckedChange={setAv1RowMt} />
                      </div>
                    </div>

                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Tile Columns</span>
                      <input
                        className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                        value={av1TileColumns}
                        onChange={(event) => setAv1TileColumns(event.target.value)}
                        placeholder="2"
                      />
                    </label>

                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Tile Rows</span>
                      <input
                        className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                        value={av1TileRows}
                        onChange={(event) => setAv1TileRows(event.target.value)}
                        placeholder="1"
                      />
                    </label>
                  </div>
                ) : null}

                {formEncoder === "svtav1" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">SVT Tune</span>
                      <Select value={av1SvtTune} onValueChange={setAv1SvtTune}>
                        <SelectTrigger>
                          <SelectValue placeholder="选择 Tune" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">VQ</SelectItem>
                          <SelectItem value="1">PSNR</SelectItem>
                          <SelectItem value="2">SSIM</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Film Grain</span>
                      <Select value={av1FilmGrain} onValueChange={setAv1FilmGrain}>
                        <SelectTrigger>
                          <SelectValue placeholder="选择颗粒强度" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">关闭</SelectItem>
                          <SelectItem value="4">轻微</SelectItem>
                          <SelectItem value="8">中等</SelectItem>
                          <SelectItem value="12">明显</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                ) : null}

                {!isAv1SoftwareEncoder ? (
                  <div className="rounded-2xl border bg-background/60 p-3 text-sm text-muted-foreground">
                    当前硬件 AV1 编码器暂不暴露软件编码高级项，仅沿用码率、分辨率、FPS、像素格式等通用参数。
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Preset</span>
                <Select value={formPreset || "none"} onValueChange={(value) => setFormPreset(value === "none" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择 preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedEncoderCapability?.presets?.length ? (
                      selectedEncoderCapability.presets.map((preset) => (
                        <SelectItem key={preset} value={preset}>
                          {preset}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none">当前编码器无 preset</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{presetHint}</p>
              </label>
              <div className="rounded-2xl border bg-muted/30 p-3 md:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">保持原始尺寸</div>
                    <p className="text-xs text-muted-foreground">
                      打开后自动使用源视频分辨率，并禁用手动宽高输入。
                    </p>
                  </div>
                  <Switch checked={keepOriginalResolution} onCheckedChange={setKeepOriginalResolution} />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  当前源尺寸：{videoMetadata?.video?.width ?? "-"} x {videoMetadata?.video?.height ?? "-"}
                </div>
              </div>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Width</span>
                <input
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={formWidth}
                  onChange={(event) => setFormWidth(event.target.value)}
                  disabled={keepOriginalResolution}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Height</span>
                <input
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={formHeight}
                  onChange={(event) => setFormHeight(event.target.value)}
                  disabled={keepOriginalResolution}
                />
              </label>
            </div>

            {isDolbyVisionSource ? (
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">保留 Dolby Vision 元数据（实验性）</div>
                    <p className="text-xs text-muted-foreground">{dolbyVisionCopy.hint}</p>
                    {!canPreserveDolbyVision ? (
                      <p className="text-xs font-medium text-destructive">
                        无法开启：{dolbyVisionCopy.disabledReason}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={preserveDolbyVisionMetadata}
                    onCheckedChange={setPreserveDolbyVisionMetadata}
                    disabled={!canPreserveDolbyVision}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>源 HDR: {videoMetadata?.video?.hdrType ?? "-"}</span>
                  <span>推荐编码器: {ffmpegProbe?.dolbyVision.recommendedEncoder ?? "-"}</span>
                  <span>dovi_rpu: {ffmpegProbe?.dolbyVision.supportsDoviRpu ? "yes" : "no"}</span>
                  <span>
                    libx265 DV encode: {ffmpegProbe?.dolbyVision.supportsDolbyVisionEncode ? "yes" : "no"}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">输出容器</span>
                <Select value={containerFormat} onValueChange={(value) => setContainerFormat(value as "mp4" | "mkv" | "mov")}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择输出容器" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mp4">MP4</SelectItem>
                    <SelectItem value="mkv">MKV</SelectItem>
                    <SelectItem value="mov">MOV</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="rounded-2xl border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Fast Start</div>
                    <p className="text-xs text-muted-foreground">仅 MP4 生效，用于优化边下边播。</p>
                  </div>
                  <Switch
                    checked={containerFaststart}
                    onCheckedChange={setContainerFaststart}
                    disabled={containerFormat !== "mp4"}
                  />
                </div>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-3 md:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">保持原始帧率</div>
                    <p className="text-xs text-muted-foreground">
                      打开后不生成 FPS 覆盖参数，沿用源视频帧率。
                    </p>
                  </div>
                  <Switch checked={keepOriginalFps} onCheckedChange={setKeepOriginalFps} />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  当前源帧率：{videoMetadata?.video?.fps?.toFixed(3).replace(/\.?0+$/, "") ?? "-"}
                </div>
              </div>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">FPS</span>
                <input
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={formFps}
                  onChange={(event) => setFormFps(event.target.value)}
                  disabled={keepOriginalFps}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Pixel Format</span>
                <Select value={formPixelFormat} onValueChange={setFormPixelFormat}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择像素格式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yuv420p">yuv420p</SelectItem>
                    <SelectItem value="yuv420p10le">yuv420p10le</SelectItem>
                    <SelectItem value="yuv422p">yuv422p</SelectItem>
                    <SelectItem value="yuv444p">yuv444p</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Primaries</span>
                <Select value={formColorPrimaries} onValueChange={setFormColorPrimaries}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择色域原色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bt709">bt709</SelectItem>
                    <SelectItem value="bt2020">bt2020</SelectItem>
                    <SelectItem value="smpte170m">smpte170m</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Transfer / Matrix</span>
                <div className="grid gap-3">
                  <Select value={formColorTrc} onValueChange={setFormColorTrc}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择 TRC" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bt709">bt709</SelectItem>
                      <SelectItem value="smpte2084">PQ</SelectItem>
                      <SelectItem value="arib-std-b67">HLG</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={formColorspace} onValueChange={setFormColorspace}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择色彩矩阵" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bt709">bt709</SelectItem>
                      <SelectItem value="bt2020nc">bt2020nc</SelectItem>
                      <SelectItem value="smpte170m">smpte170m</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-4">
              <div className="space-y-1">
                <div className="font-medium">下一步操作</div>
                <p className="text-sm text-muted-foreground">当前页面同时支持保存草稿、进入预览和保存为模板。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline">保存草稿</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep("preview");
                    onGoPreview();
                  }}
                >
                  进入预览
                </Button>
                <Button
                  onClick={() => {
                    setStep("enqueue");
                  }}
                >
                  保存为模板
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

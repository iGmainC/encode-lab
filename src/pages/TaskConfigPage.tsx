import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { useI18n } from "../i18n/I18nProvider";
import type { EncoderCapability, FfmpegProbeResult, SaveTemplateResponse } from "../types/workbench";

type Props = {
  filteredEncoders: EncoderCapability[];
  selectedEncoderCapability?: EncoderCapability;
  ffmpegProbe: FfmpegProbeResult | null;
  onGoPreview: () => void;
  onTemplatesChanged: () => void;
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
  t,
}: {
  isDolbyVisionSource: boolean;
  formCodec: string;
  formEncoder: string;
  ffmpegProbe: FfmpegProbeResult | null;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (!isDolbyVisionSource) {
    return {
      hint: t("config.dv.nonDv.hint"),
      disabledReason: t("config.dv.nonDv.disabled"),
    };
  }

  if (!ffmpegProbe) {
    return {
      hint: t("config.dv.probing.hint"),
      disabledReason: t("config.dv.probing.disabled"),
    };
  }

  if (!ffmpegProbe.ffmpegFound) {
    return {
      hint: t("config.dv.noFfmpeg.hint"),
      disabledReason: t("config.dv.noFfmpeg.disabled"),
    };
  }

  if (!ffmpegProbe.dolbyVision.supportsDoviRpu) {
    return {
      hint: t("config.dv.noRpu.hint"),
      disabledReason: t("config.dv.noRpu.disabled"),
    };
  }

  if (!ffmpegProbe.dolbyVision.supportsDolbyVisionEncode) {
    return {
      hint: t("config.dv.noEncode.hint"),
      disabledReason: t("config.dv.noEncode.disabled"),
    };
  }

  if (formCodec !== "h265" || formEncoder !== "libx265") {
    return {
      hint: t("config.dv.onlyLibx265.hint"),
      disabledReason: t("config.dv.onlyLibx265.disabled", { codec: formCodec, encoder: formEncoder }),
    };
  }

  return {
    hint: t("config.dv.ready.hint"),
    disabledReason: "",
  };
}

export function TaskConfigPage({
  filteredEncoders,
  selectedEncoderCapability,
  ffmpegProbe,
  onGoPreview,
  onTemplatesChanged,
}: Props) {
  const { t } = useI18n();
  const [savingTemplate, setSavingTemplate] = useState(false);
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
    clipStartSec,
    setClipStartSec,
    clipEndSec,
    setClipEndSec,
    sourceFilePath,
    setSourceFilePath,
    videoMetadata,
    videoMetadataLoading,
    videoMetadataError,
    isDragOverWindow,
    pickSourceFile,
    retryVideoMetadata,
    taskDraftSnapshot,
  } = useTaskDraft();

  const isDolbyVisionSource = videoMetadata?.video?.hdrType === "DolbyVision";
  const dolbyVisionCopy = buildDolbyVisionPreserveCopy({
    isDolbyVisionSource,
    formCodec,
    formEncoder,
    ffmpegProbe,
    t,
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
      ? t("config.preset.noneHint")
      : formPreset === "ultrafast" || formPreset === "superfast" || formPreset === "veryfast"
        ? t("config.preset.fastHint")
        : formPreset === "medium" || formPreset === "fast" || formPreset === "slow"
          ? t("config.preset.balancedHint")
          : t("config.preset.qualityHint");

  const isAv1SoftwareEncoder = formEncoder === "libaom-av1" || formEncoder === "svtav1";

  /**
   * 将当前参数面板保存为参数方案。
   */
  async function saveCurrentTemplate() {
    const name = window.prompt(t("config.savePresetPrompt"), taskDraftSnapshot.name || "preview-draft");
    if (!name?.trim()) {
      return;
    }

    setSavingTemplate(true);
    try {
      await invoke<SaveTemplateResponse>("save_template", {
        payload: {
          name: name.trim(),
          tags: [],
          taskConfigSnapshot: {
            ...taskDraftSnapshot,
            name: name.trim(),
          },
        },
      });
      onTemplatesChanged();
    } finally {
      setSavingTemplate(false);
    }
  }

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
          <TrimRangeControl
            durationSec={videoMetadata?.durationSec ?? 0}
            fps={videoMetadata?.video?.fps}
            startSec={clipStartSec}
            endSec={clipEndSec}
            onChange={(startSec, endSec) => {
              setClipStartSec(startSec);
              setClipEndSec(endSec);
            }}
            labels={{
              title: t("trim.title"),
              description: t("trim.description"),
              start: t("trim.start"),
              end: t("trim.end"),
              duration: t("trim.duration"),
              full: t("trim.full"),
              unavailable: t("trim.unavailable"),
            }}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("config.panel.title")}</CardTitle>
            <CardDescription>{t("config.panel.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Codec</span>
                <Select value={formCodec} onValueChange={setFormCodec}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("config.selectCodec")} />
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
                    <SelectValue placeholder={t("config.selectEncoder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredEncoders.map((item) => (
                      <SelectItem key={item.encoder} value={item.encoder}>
                        {item.displayName} {item.available ? "" : `(${t("config.unavailable")})`}
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
                    <SelectValue placeholder={t("config.selectRateMode")} />
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
                    <SelectValue placeholder={t("config.selectTwoPass")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">{t("common.off")}</SelectItem>
                    <SelectItem value="yes">{t("common.on")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            {formMode === "CRF" ? (
              <Card className="border-dashed shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("config.crf")}</span>
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
                  <p className="text-xs text-muted-foreground">{t("config.crfHint")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{t("config.targetBitrate")}</span>
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
                    <div className="text-sm font-medium">{t("config.av1.title")}</div>
                    <p className="text-xs text-muted-foreground">
                      {t("config.av1.description")}
                    </p>
                  </div>
                  <div className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                    {isAv1SoftwareEncoder ? t("config.av1.software") : t("config.av1.hardware")}
                  </div>
                </div>

                {formEncoder === "libaom-av1" ? (
                  <div className="grid gap-4 md:grid-cols-4">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">cpu-used</span>
                      <Select value={av1CpuUsed} onValueChange={setAv1CpuUsed}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("config.av1.speedSelect")} />
                        </SelectTrigger>
                        <SelectContent>
                          {["0", "1", "2", "3", "4", "5", "6", "7", "8"].map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{t("config.av1.speedHint")}</p>
                    </label>

                    <div className="rounded-2xl border bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">row-mt</div>
                          <p className="text-xs text-muted-foreground">{t("config.av1.rowMt")}</p>
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
                          <SelectValue placeholder={t("config.av1.tuneSelect")} />
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
                          <SelectValue placeholder={t("config.av1.grainSelect")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">{t("common.off")}</SelectItem>
                          <SelectItem value="4">{t("config.av1.grainLight")}</SelectItem>
                          <SelectItem value="8">{t("config.av1.grainMedium")}</SelectItem>
                          <SelectItem value="12">{t("config.av1.grainStrong")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                ) : null}

                {!isAv1SoftwareEncoder ? (
                  <div className="rounded-2xl border bg-background/60 p-3 text-sm text-muted-foreground">
                    {t("config.av1.hardwareHint")}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Preset</span>
                <Select value={formPreset || "none"} onValueChange={(value) => setFormPreset(value === "none" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("config.selectPreset")} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedEncoderCapability?.presets?.length ? (
                      selectedEncoderCapability.presets.map((preset) => (
                        <SelectItem key={preset} value={preset}>
                          {preset}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none">{t("config.noPreset")}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{presetHint}</p>
              </label>
              <div className="rounded-2xl border bg-muted/30 p-3 md:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{t("config.keepResolution")}</div>
                    <p className="text-xs text-muted-foreground">
                      {t("config.keepResolutionHint")}
                    </p>
                  </div>
                  <Switch checked={keepOriginalResolution} onCheckedChange={setKeepOriginalResolution} />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("config.sourceSize", { width: videoMetadata?.video?.width ?? "-", height: videoMetadata?.video?.height ?? "-" })}
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
                    <div className="text-sm font-medium">{t("config.dv.title")}</div>
                    <p className="text-xs text-muted-foreground">{dolbyVisionCopy.hint}</p>
                    {!canPreserveDolbyVision ? (
                      <p className="text-xs font-medium text-destructive">
                        {t("config.dv.disabledPrefix", { reason: dolbyVisionCopy.disabledReason })}
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
                  <span>{t("config.sourceHdr", { value: videoMetadata?.video?.hdrType ?? "-" })}</span>
                  <span>{t("config.recommendedEncoder", { value: ffmpegProbe?.dolbyVision.recommendedEncoder ?? "-" })}</span>
                  <span>dovi_rpu: {ffmpegProbe?.dolbyVision.supportsDoviRpu ? "yes" : "no"}</span>
                  <span>
                    libx265 DV encode: {ffmpegProbe?.dolbyVision.supportsDolbyVisionEncode ? "yes" : "no"}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">{t("config.outputContainer")}</span>
                <Select value={containerFormat} onValueChange={(value) => setContainerFormat(value as "mp4" | "mkv" | "mov")}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("config.selectOutputContainer")} />
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
                    <p className="text-xs text-muted-foreground">{t("config.faststartHint")}</p>
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
                    <div className="text-sm font-medium">{t("config.keepFps")}</div>
                    <p className="text-xs text-muted-foreground">
                      {t("config.keepFpsHint")}
                    </p>
                  </div>
                  <Switch checked={keepOriginalFps} onCheckedChange={setKeepOriginalFps} />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("config.sourceFps", { value: videoMetadata?.video?.fps?.toFixed(3).replace(/\.?0+$/, "") ?? "-" })}
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
                    <SelectValue placeholder={t("config.selectPixelFormat")} />
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
                    <SelectValue placeholder={t("config.selectPrimaries")} />
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
                      <SelectValue placeholder={t("config.selectTrc")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bt709">bt709</SelectItem>
                      <SelectItem value="smpte2084">PQ</SelectItem>
                      <SelectItem value="arib-std-b67">HLG</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={formColorspace} onValueChange={setFormColorspace}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("config.selectColorspace")} />
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
                <div className="font-medium">{t("config.next.title")}</div>
                <p className="text-sm text-muted-foreground">{t("config.next.description")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline">{t("config.saveDraft")}</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep("preview");
                    onGoPreview();
                  }}
                >
                  {t("config.goPreview")}
                </Button>
                <Button
                  disabled={savingTemplate}
                  onClick={() => void saveCurrentTemplate()}
                >
                  {savingTemplate ? t("config.saving") : t("config.savePreset")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TrimRangeControl({
  durationSec,
  fps,
  startSec,
  endSec,
  onChange,
  labels,
}: {
  durationSec: number;
  fps?: number;
  startSec: number;
  endSec: number;
  onChange: (startSec: number, endSec: number) => void;
  labels: {
    title: string;
    description: string;
    start: string;
    end: string;
    duration: string;
    full: string;
    unavailable: string;
  };
}) {
  const frameStepSec = fps && fps > 0 ? 1 / fps : 1 / 30;
  const hasDuration = durationSec > 0;
  const safeEndSec = hasDuration ? Math.min(Math.max(endSec || durationSec, frameStepSec), durationSec) : 0;
  const safeStartSec = hasDuration ? Math.min(Math.max(startSec, 0), Math.max(0, safeEndSec - frameStepSec)) : 0;
  const isFullRange = hasDuration && safeStartSec <= 0 && Math.abs(safeEndSec - durationSec) < frameStepSec / 2;
  const [startText, setStartText] = useState(() => formatTimecode(safeStartSec));
  const [endText, setEndText] = useState(() => formatTimecode(safeEndSec));

  useEffect(() => {
    setStartText(formatTimecode(safeStartSec));
    setEndText(formatTimecode(safeEndSec));
  }, [safeStartSec, safeEndSec]);

  function commitTextValue(which: "start" | "end") {
    const rawValue = which === "start" ? startText : endText;
    const parsedSec = parseTimecode(rawValue);
    if (parsedSec === null || !hasDuration) {
      setStartText(formatTimecode(safeStartSec));
      setEndText(formatTimecode(safeEndSec));
      return;
    }

    const snappedSec = snapToFrame(parsedSec, frameStepSec, durationSec);
    if (which === "start") {
      onChange(Math.max(0, Math.min(snappedSec, safeEndSec - frameStepSec)), safeEndSec);
      return;
    }

    onChange(safeStartSec, Math.min(durationSec, Math.max(snappedSec, safeStartSec + frameStepSec)));
  }

  function updateRange(values: number[]) {
    if (!hasDuration) {
      return;
    }

    const nextStart = snapToFrame(values[0] ?? 0, frameStepSec, durationSec);
    const nextEnd = snapToFrame(values[1] ?? durationSec, frameStepSec, durationSec);
    if (nextEnd <= nextStart) {
      return;
    }

    onChange(nextStart, nextEnd);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {hasDuration ? (
          <>
            <Slider
              min={0}
              max={durationSec}
              step={frameStepSec}
              value={[safeStartSec, safeEndSec]}
              onValueChange={updateRange}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{labels.start}</span>
                <input
                  className="h-10 rounded-xl border bg-background px-3 text-sm"
                  value={startText}
                  onChange={(event) => setStartText(event.target.value)}
                  onBlur={() => commitTextValue("start")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitTextValue("start");
                    }
                  }}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{labels.end}</span>
                <input
                  className="h-10 rounded-xl border bg-background px-3 text-sm"
                  value={endText}
                  onChange={(event) => setEndText(event.target.value)}
                  onBlur={() => commitTextValue("end")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitTextValue("end");
                    }
                  }}
                />
              </label>
            </div>
            <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
              {labels.duration}: {formatTimecode(Math.max(0, safeEndSec - safeStartSec))}
              {isFullRange ? ` · ${labels.full}` : ""}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            {labels.unavailable}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function snapToFrame(valueSec: number, frameStepSec: number, durationSec: number) {
  const clamped = Math.min(Math.max(valueSec, 0), durationSec);
  return Math.min(durationSec, Math.max(0, Math.round(clamped / frameStepSec) * frameStepSec));
}

function formatTimecode(valueSec: number) {
  const totalMs = Math.max(0, Math.round(valueSec * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function parseTimecode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const [hoursPart, minutesPart, secondsPart] =
    parts.length === 3 ? parts : ["0", parts[0], parts[1]];
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

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
import type { EncoderCapability } from "../types/workbench";

type Props = {
  filteredEncoders: EncoderCapability[];
  selectedEncoderCapability?: EncoderCapability;
  onGoPreview: () => void;
};

export function TaskConfigPage({ filteredEncoders, selectedEncoderCapability, onGoPreview }: Props) {
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
    sourceFilePath,
    setSourceFilePath,
    videoMetadata,
    videoMetadataLoading,
    videoMetadataError,
    isDragOverWindow,
    pickSourceFile,
    retryVideoMetadata,
  } = useTaskDraft();

  const presetHint =
    formPreset === ""
      ? "当前编码器通常不提供 preset 档位。"
      : formPreset === "ultrafast" || formPreset === "superfast" || formPreset === "veryfast"
        ? "偏速度：编码更快，体积通常更大。"
        : formPreset === "medium" || formPreset === "fast" || formPreset === "slow"
          ? "均衡档：速度与压缩效率平衡，推荐先从这里开始。"
          : "偏质量/压缩：编码更慢，体积通常更小。";

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

            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">FPS</span>
                <input
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                  value={formFps}
                  onChange={(event) => setFormFps(event.target.value)}
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

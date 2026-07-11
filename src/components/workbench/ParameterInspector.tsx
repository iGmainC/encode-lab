import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Library,
  Save,
  Send,
} from "lucide-react";
import { useTaskDraft } from "../../context/TaskDraftContext";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import {
  getDolbyVisionPreserveStatus,
  type InspectorTab,
  type WorkbenchValidationIssue,
} from "../../lib/workbenchPolicy";
import type {
  EncoderCapability,
  FfmpegProbeResult,
} from "../../types/workbench";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";

type ParameterInspectorProps = {
  filteredEncoders: EncoderCapability[];
  selectedEncoderCapability?: EncoderCapability;
  ffmpegProbe: FfmpegProbeResult | null;
  issues: WorkbenchValidationIssue[];
  isEnqueuing: boolean;
  enqueueError: string | null;
  onOpenTemplates: () => void;
  onEnqueue: () => Promise<void>;
  onSaveTemplate: (input: { name: string; tags: string[] }) => Promise<void>;
};

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "color", label: "色彩 / HDR" },
  { id: "output", label: "输出" },
];

/** 专业检查器输入框的统一视觉和键盘焦点样式。 */
const INPUT_CLASS =
  "h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 常驻专业参数检查器。所有主控件直接写入任务快照，页签只负责组织复杂度。
 */
export function ParameterInspector({
  filteredEncoders,
  selectedEncoderCapability,
  ffmpegProbe,
  issues,
  isEnqueuing,
  enqueueError,
  onOpenTemplates,
  onEnqueue,
  onSaveTemplate,
}: ParameterInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("video");
  const [isSaveFormOpen, setIsSaveFormOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState<string | null>(null);
  const [outputActionError, setOutputActionError] = useState<string | null>(null);
  const draft = useTaskDraft();
  const dolbyVisionStatus = getDolbyVisionPreserveStatus(draft.videoMetadata, ffmpegProbe);
  const isAv1 = draft.formCodec === "av1";
  const blockingIssues = issues.filter((issue) => issue.tone === "error");

  /**
   * 为参数页签提供标准方向键、Home 和 End 键盘导航。
   * @param event 当前页签的键盘事件
   * @param currentIndex 当前页签索引
   */
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`parameter-tab-${nextTab.id}`)?.focus());
  }

  useEffect(() => {
    if (!dolbyVisionStatus.available && draft.preserveDolbyVisionMetadata) {
      draft.setPreserveDolbyVisionMetadata(false);
    }
  }, [dolbyVisionStatus.available, draft.preserveDolbyVisionMetadata, draft.setPreserveDolbyVisionMetadata]);

  useEffect(() => {
    if (!dolbyVisionStatus.available || !draft.preserveDolbyVisionMetadata) {
      return;
    }

    const durationSec = draft.videoMetadata?.durationSec ?? 0;
    const profile = draft.videoMetadata?.video?.dolbyVisionProfile;
    // DV 专用链路持续归一化硬约束，模板恢复和替换素材也不能绕过。
    if (draft.formCodec !== "h265") draft.setFormCodec("h265");
    if (draft.formEncoder !== "libx265") draft.setFormEncoder("libx265");
    if (draft.formMode !== "CRF") draft.setFormMode("CRF");
    if (draft.formTwoPass) draft.setFormTwoPass(false);
    if (!draft.keepOriginalResolution) draft.setKeepOriginalResolution(true);
    if (!draft.keepOriginalFps) draft.setKeepOriginalFps(true);
    if (draft.formPixelFormat !== "yuv420p10le") draft.setFormPixelFormat("yuv420p10le");
    if (draft.containerFormat !== "mkv") draft.setContainerFormat("mkv");
    if (draft.containerFaststart) draft.setContainerFaststart(false);
    if (draft.clipStartSec !== 0) draft.setClipStartSec(0);
    if (draft.clipEndSec !== durationSec) draft.setClipEndSec(durationSec);
    if (draft.formColorPrimaries !== "bt2020") draft.setFormColorPrimaries("bt2020");
    if (draft.formColorTrc !== "smpte2084") draft.setFormColorTrc("smpte2084");
    const requiredMatrix = profile === 5 ? "ipt-c2" : "bt2020nc";
    if (draft.formColorspace !== requiredMatrix) draft.setFormColorspace(requiredMatrix);
  }, [
    dolbyVisionStatus.available,
    draft.clipEndSec,
    draft.clipStartSec,
    draft.containerFaststart,
    draft.containerFormat,
    draft.formCodec,
    draft.formColorPrimaries,
    draft.formColorTrc,
    draft.formColorspace,
    draft.formEncoder,
    draft.formMode,
    draft.formPixelFormat,
    draft.formTwoPass,
    draft.keepOriginalFps,
    draft.keepOriginalResolution,
    draft.preserveDolbyVisionMetadata,
    draft.setClipEndSec,
    draft.setClipStartSec,
    draft.setContainerFaststart,
    draft.setContainerFormat,
    draft.setFormCodec,
    draft.setFormColorPrimaries,
    draft.setFormColorTrc,
    draft.setFormColorspace,
    draft.setFormEncoder,
    draft.setFormMode,
    draft.setFormPixelFormat,
    draft.setFormTwoPass,
    draft.setKeepOriginalFps,
    draft.setKeepOriginalResolution,
    draft.videoMetadata?.durationSec,
    draft.videoMetadata?.video?.dolbyVisionProfile,
  ]);

  /** 选择任务级输出目录。 */
  async function pickOutputDirectory() {
    if (!isTauriRuntime()) {
      return;
    }
    setOutputActionError(null);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        draft.setOutputDir(selected);
      }
    } catch (error) {
      setOutputActionError(`选择输出目录失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 开启 DV 保留时先写入平衡 preset，其他硬约束由归一化 effect 负责。 */
  function toggleDolbyVisionPreservation(checked: boolean) {
    if (checked) {
      draft.setFormPreset("medium");
    }
    draft.setPreserveDolbyVisionMetadata(checked);
  }

  /** 展开内联保存表单，并给出不会覆盖现有方案的默认名称。 */
  function openTemplateSaveForm() {
    const activeName = draft.activeTemplateName.trim();
    setTemplateName(
      activeName && activeName !== "自定义配置"
        ? `${activeName} 副本`
        : `${draft.draftName.trim() || "新转码"} 方案`,
    );
    setTemplateTags("");
    setTemplateSaveError(null);
    setTemplateSaveSuccess(null);
    setIsSaveFormOpen(true);
  }

  /** 校验并保存当前参数方案。 */
  async function saveCurrentTemplate() {
    const name = templateName.trim();
    if (!name) {
      setTemplateSaveError("方案名称不能为空。");
      return;
    }

    setIsSavingTemplate(true);
    setTemplateSaveError(null);
    try {
      await onSaveTemplate({ name, tags: parseTemplateTags(templateTags) });
      setTemplateSaveSuccess(`方案“${name}”已保存。`);
      setIsSaveFormOpen(false);
    } catch (error) {
      setTemplateSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingTemplate(false);
    }
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card/80 xl:h-full" aria-label="专业参数检查器">
      <div className="grid grid-cols-4 border-b" role="tablist" aria-label="参数分组">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`parameter-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`parameter-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`relative px-2 py-3 text-xs font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 ${
              activeTab === tab.id ? "text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
            {activeTab === tab.id ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-primary" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>

      <div
        id={`parameter-panel-${activeTab}`}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        role="tabpanel"
        aria-labelledby={`parameter-tab-${activeTab}`}
      >
        {activeTab === "video" ? (
          <VideoInspector
            filteredEncoders={filteredEncoders}
            selectedEncoderCapability={selectedEncoderCapability}
          />
        ) : null}
        {activeTab === "audio" ? <AudioInspector /> : null}
        {activeTab === "color" ? (
          <ColorInspector
            dolbyVisionAvailable={dolbyVisionStatus.available}
            dolbyVisionDetail={dolbyVisionStatus.detail}
            onToggleDolbyVision={toggleDolbyVisionPreservation}
          />
        ) : null}
        {activeTab === "output" ? <OutputInspector onPickOutputDirectory={pickOutputDirectory} /> : null}

        {isAv1 && activeTab === "video" ? <Av1Inspector /> : null}

        <details className="mt-3 rounded-md border bg-muted/15">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            FFmpeg 专家参数
          </summary>
          <div className="border-t px-3 py-2">
            <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-muted-foreground">
              {draft.taskDraftSnapshot.advancedArgs || "当前结构化参数不需要额外 FFmpeg flags。"}
            </code>
          </div>
        </details>
      </div>

      <div className="shrink-0 border-t bg-background/70 p-3">
        {issues.length > 0 ? (
          <div className="mb-3 space-y-1.5" aria-live="polite">
            {issues.slice(0, 3).map((issue) => (
              <button
                key={issue.id}
                type="button"
                className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${
                  issue.tone === "error" ? "border-destructive/30 text-destructive" : "border-amber-500/30 text-amber-700 dark:text-amber-300"
                }`}
                onClick={() => setActiveTab(issue.tab)}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{issue.message}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            当前参数通过已知执行约束
          </div>
        )}

        {isSaveFormOpen ? (
          <div className="mb-3 space-y-2 rounded-md border bg-muted/15 p-2.5">
            <div className="text-xs font-semibold">保存当前参数为方案</div>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              <span>方案名称</span>
              <input
                className={INPUT_CLASS}
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                aria-label="方案名称"
                autoFocus
              />
            </label>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              <span>标签（用逗号分隔）</span>
              <input
                className={INPUT_CLASS}
                value={templateTags}
                onChange={(event) => setTemplateTags(event.target.value)}
                placeholder="web, archive, hdr"
                aria-label="方案标签"
              />
            </label>
            {templateSaveError ? <div className="text-xs text-destructive" role="alert">{templateSaveError}</div> : null}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setIsSaveFormOpen(false)} disabled={isSavingTemplate}>取消</Button>
              <Button size="sm" onClick={() => void saveCurrentTemplate()} disabled={isSavingTemplate}>
                {isSavingTemplate ? "正在保存" : "保存方案"}
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mb-2 w-full justify-start" size="sm" variant="ghost" onClick={openTemplateSaveForm}>
            <Save data-icon="inline-start" aria-hidden="true" />保存当前参数为方案
          </Button>
        )}

        {templateSaveSuccess ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400" role="status">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />{templateSaveSuccess}
          </div>
        ) : null}

        {enqueueError ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {enqueueError}
          </div>
        ) : null}

        {outputActionError ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {outputActionError}
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Button onClick={() => void onEnqueue()} disabled={blockingIssues.length > 0 || isEnqueuing}>
            <Send data-icon="inline-start" aria-hidden="true" />
            {isEnqueuing ? "正在加入队列" : "确认并加入队列"}
          </Button>
          <Button variant="secondary" onClick={onOpenTemplates} aria-label="打开方案库">
            <Library aria-hidden="true" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

/**
 * 将用户输入的逗号标签转换为去重后的方案标签。
 * @param value 逗号分隔的标签文本
 */
function parseTemplateTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

/** 视频编码、质量、尺寸与帧率设置。 */
function VideoInspector({
  filteredEncoders,
  selectedEncoderCapability,
}: {
  filteredEncoders: EncoderCapability[];
  selectedEncoderCapability?: EncoderCapability;
}) {
  const draft = useTaskDraft();
  const presetOptions = selectedEncoderCapability?.presets ?? [];
  const isStreamCopy = draft.formCodec === "copy";

  return (
    <div className="space-y-3">
      <InspectorSection title="编码设置">
        <div className="grid gap-3 sm:grid-cols-2">
          <InspectorField label="Codec">
            <Select value={draft.formCodec} onValueChange={draft.setFormCodec} disabled={draft.preserveDolbyVisionMetadata}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="h264">H.264</SelectItem>
                <SelectItem value="h265">H.265</SelectItem>
                <SelectItem value="av1">AV1</SelectItem>
                <SelectItem value="vp9">VP9</SelectItem>
                <SelectItem value="copy">Copy</SelectItem>
              </SelectContent>
            </Select>
          </InspectorField>
          {!isStreamCopy ? (
            <>
              <InspectorField label="Encoder" hint={selectedEncoderCapability?.available ? "可用" : "检查本机能力"}>
                <Select value={draft.formEncoder} onValueChange={draft.setFormEncoder} disabled={draft.preserveDolbyVisionMetadata}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {filteredEncoders.map((encoder) => (
                      <SelectItem key={encoder.encoder} value={encoder.encoder} disabled={!encoder.available}>
                        {encoder.displayName}{encoder.available ? "" : "（不可用）"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InspectorField>
              <InspectorField label="Rate Control">
                <Select
                  value={draft.formMode}
                  onValueChange={(value) => draft.setFormMode(value as "CRF" | "CBR" | "ABR")}
                  disabled={draft.preserveDolbyVisionMetadata}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRF" disabled={!selectedEncoderCapability?.supportsCrf}>CRF</SelectItem>
                    <SelectItem value="CBR">CBR</SelectItem>
                    <SelectItem value="ABR">ABR</SelectItem>
                  </SelectContent>
                </Select>
              </InspectorField>
              <InspectorField label="Preset" hint={presetOptions.length === 0 ? "当前编码器没有 preset" : undefined}>
                <Select value={draft.formPreset} onValueChange={draft.setFormPreset} disabled={presetOptions.length === 0}>
                  <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
                  <SelectContent>
                    {presetOptions.map((preset) => <SelectItem key={preset} value={preset}>{preset}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InspectorField>
            </>
          ) : null}
        </div>

        {isStreamCopy ? (
          <DependencyHint tone="success">
            视频轨道将直接复制，不执行码率控制、缩放、改帧率、像素格式转换或色彩重编码。
          </DependencyHint>
        ) : draft.formMode === "CRF" ? (
          <div className="rounded-md border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="crf-value" className="text-xs text-muted-foreground">CRF</label>
              <input
                id="crf-value"
                className="h-8 w-16 rounded-md border bg-background px-2 text-right font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                type="number"
                min={0}
                max={51}
                value={draft.formCrf}
                onChange={(event) => draft.setFormCrf(Math.min(51, Math.max(0, Number(event.target.value))))}
              />
            </div>
            <Slider
              className="mt-3"
              min={0}
              max={51}
              step={1}
              value={[draft.formCrf]}
              onValueChange={(value) => draft.setFormCrf(value[0] ?? 23)}
              aria-label="CRF 质量值"
            />
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>更高质量</span><span>推荐 18–28</span><span>更小体积</span>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="目标码率 (kbps)" value={draft.formBitrateKbps} onChange={draft.setFormBitrateKbps} inputMode="numeric" />
            <TextField label="maxrate (kbps)" value={draft.formMaxrateKbps} onChange={draft.setFormMaxrateKbps} inputMode="numeric" />
            <TextField label="bufsize (kbps)" value={draft.formBufsizeKbps} onChange={draft.setFormBufsizeKbps} inputMode="numeric" />
          </div>
        )}

        {!isStreamCopy ? (
          <ToggleRow
            label="2-pass"
            description={selectedEncoderCapability?.supportsTwoPass ? "使用两遍编码执行正式任务。" : "当前编码器不支持两遍编码。"}
            checked={draft.formTwoPass}
            disabled={draft.preserveDolbyVisionMetadata || !selectedEncoderCapability?.supportsTwoPass}
            onCheckedChange={draft.setFormTwoPass}
          />
        ) : null}
      </InspectorSection>

      {!isStreamCopy ? (
        <InspectorSection title="画面规格">
          <ToggleRow
            label="保持源尺寸"
            description={draft.videoMetadata?.video?.width && draft.videoMetadata.video.height ? `源尺寸 ${draft.videoMetadata.video.width} × ${draft.videoMetadata.video.height}` : "读取素材后显示源尺寸。"}
            checked={draft.keepOriginalResolution}
            disabled={draft.preserveDolbyVisionMetadata}
            onCheckedChange={draft.setKeepOriginalResolution}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Width" value={draft.formWidth} onChange={draft.setFormWidth} inputMode="numeric" disabled={draft.keepOriginalResolution} />
            <TextField label="Height" value={draft.formHeight} onChange={draft.setFormHeight} inputMode="numeric" disabled={draft.keepOriginalResolution} />
          </div>
          <ToggleRow
            label="保持源帧率"
            description={draft.videoMetadata?.video?.fps ? `源帧率 ${draft.videoMetadata.video.fps}` : "读取素材后显示源帧率。"}
            checked={draft.keepOriginalFps}
            disabled={draft.preserveDolbyVisionMetadata}
            onCheckedChange={draft.setKeepOriginalFps}
          />
          <TextField label="Frame Rate" value={draft.formFps} onChange={draft.setFormFps} inputMode="decimal" disabled={draft.keepOriginalFps} />
          <InspectorField label="Pixel Format">
            <Select value={draft.formPixelFormat} onValueChange={draft.setFormPixelFormat} disabled={draft.preserveDolbyVisionMetadata}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yuv420p">yuv420p</SelectItem>
                <SelectItem value="yuv420p10le">yuv420p10le</SelectItem>
                <SelectItem value="yuv422p10le">yuv422p10le</SelectItem>
                <SelectItem value="yuv444p10le">yuv444p10le</SelectItem>
              </SelectContent>
            </Select>
          </InspectorField>
        </InspectorSection>
      ) : null}
    </div>
  );
}

/** 音频复制与专业自定义参数。 */
function AudioInspector() {
  const draft = useTaskDraft();
  const sourceAudio = draft.videoMetadata?.audio;
  return (
    <div className="space-y-3">
      <InspectorSection title="源音轨">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <ReadOnlyValue label="Codec" value={sourceAudio?.codecName ?? "-"} />
          <ReadOnlyValue label="Layout" value={sourceAudio?.channelLayout ?? "-"} />
          <ReadOnlyValue label="Sample Rate" value={sourceAudio?.sampleRate ? `${sourceAudio.sampleRate} Hz` : "-"} />
          <ReadOnlyValue label="Bitrate" value={sourceAudio?.bitRateKbps ? `${sourceAudio.bitRateKbps} kbps` : "-"} />
        </dl>
      </InspectorSection>
      <InspectorSection title="输出音频">
        <InspectorField label="Mode">
          <Select value={draft.audioMode} onValueChange={(value) => draft.setAudioMode(value as "copy" | "custom")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="copy">Copy source stream</SelectItem>
              <SelectItem value="custom">Custom FFmpeg audio args</SelectItem>
            </SelectContent>
          </Select>
        </InspectorField>
        {draft.audioMode === "custom" ? (
          <label className="grid gap-1.5 text-xs">
            <span className="text-muted-foreground">Audio args</span>
            <textarea
              className="min-h-28 w-full resize-y rounded-md border bg-background p-2.5 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              value={draft.audioCustomArgs}
              onChange={(event) => draft.setAudioCustomArgs(event.target.value)}
              placeholder="-c:a aac -b:a 320k"
            />
            <span className="text-[11px] leading-4 text-muted-foreground">后端仍会执行参数白名单和冲突校验。</span>
          </label>
        ) : (
          <DependencyHint tone="success">正式任务将无损复制源音轨，不进行音频重编码。</DependencyHint>
        )}
      </InspectorSection>
    </div>
  );
}

/** 色彩标签、像素格式和 Dolby Vision 专用链路。 */
function ColorInspector({
  dolbyVisionAvailable,
  dolbyVisionDetail,
  onToggleDolbyVision,
}: {
  dolbyVisionAvailable: boolean;
  dolbyVisionDetail: string;
  onToggleDolbyVision: (checked: boolean) => void;
}) {
  const draft = useTaskDraft();
  const video = draft.videoMetadata?.video;
  const isStreamCopy = draft.formCodec === "copy";
  return (
    <div className="space-y-3">
      <InspectorSection title="源色彩信息">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <ReadOnlyValue label="HDR" value={video?.hdrType ?? "-"} />
          <ReadOnlyValue label="Bit Depth" value={video?.bitDepth ? `${video.bitDepth}-bit` : "-"} />
          <ReadOnlyValue label="Primaries" value={video?.colorPrimaries ?? "-"} />
          <ReadOnlyValue label="Transfer" value={video?.colorTransfer ?? "-"} />
        </dl>
      </InspectorSection>
      {isStreamCopy ? (
        <InspectorSection title="输出色彩行为">
          <DependencyHint tone="success">视频流复制会保留源轨道数据，不写入重编码色彩标签，也不执行 Dolby Vision RPU 重建。</DependencyHint>
        </InspectorSection>
      ) : (
        <>
          <InspectorSection title="输出色彩标签">
            <InspectorField label="Primaries">
              <Select value={draft.formColorPrimaries} onValueChange={draft.setFormColorPrimaries} disabled={draft.preserveDolbyVisionMetadata}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bt709">bt709</SelectItem>
                  <SelectItem value="bt2020">bt2020</SelectItem>
                  <SelectItem value="smpte170m">smpte170m</SelectItem>
                </SelectContent>
              </Select>
            </InspectorField>
            <InspectorField label="Transfer">
              <Select value={draft.formColorTrc} onValueChange={draft.setFormColorTrc} disabled={draft.preserveDolbyVisionMetadata}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bt709">bt709</SelectItem>
                  <SelectItem value="smpte2084">smpte2084 / PQ</SelectItem>
                  <SelectItem value="arib-std-b67">arib-std-b67 / HLG</SelectItem>
                </SelectContent>
              </Select>
            </InspectorField>
            <InspectorField label="Matrix">
              <Select value={draft.formColorspace} onValueChange={draft.setFormColorspace} disabled={draft.preserveDolbyVisionMetadata}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bt709">bt709</SelectItem>
                  <SelectItem value="bt2020nc">bt2020nc</SelectItem>
                  <SelectItem value="ipt-c2">ipt-c2</SelectItem>
                </SelectContent>
              </Select>
            </InspectorField>
            <DependencyHint tone="warning">这里只写入色彩标签；普通 HDR 到 SDR 的显示映射仅影响预览，不会悄悄改变正式输出。</DependencyHint>
          </InspectorSection>
          <InspectorSection title="Dolby Vision 动态元数据">
            <ToggleRow
              label="保留 Dolby Vision RPU"
              description={dolbyVisionDetail}
              checked={draft.preserveDolbyVisionMetadata}
              disabled={!dolbyVisionAvailable}
              onCheckedChange={onToggleDolbyVision}
            />
          </InspectorSection>
        </>
      )}
    </div>
  );
}

/** 容器、任务命名、输出目录与截取范围。 */
function OutputInspector({ onPickOutputDirectory }: { onPickOutputDirectory: () => Promise<void> }) {
  const draft = useTaskDraft();
  return (
    <div className="space-y-3">
      <InspectorSection title="任务与文件">
        <TextField label="任务名称" value={draft.draftName} onChange={draft.setDraftName} />
        <label className="grid gap-1.5 text-xs">
          <span className="text-muted-foreground">输出目录</span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input className={INPUT_CLASS} value={draft.outputDir} onChange={(event) => draft.setOutputDir(event.target.value)} placeholder="与源文件同目录" />
            <Button size="sm" variant="secondary" onClick={() => void onPickOutputDirectory()} disabled={!isTauriRuntime()} aria-label="选择输出目录">
              <FolderOpen aria-hidden="true" />
            </Button>
          </div>
        </label>
        <TextField label="文件名规则" value={draft.fileNamePattern} onChange={draft.setFileNamePattern} />
        <div className="text-[11px] text-muted-foreground">可用变量：{"{inputName}"}、{"{taskName}"}；同名文件自动改名，不覆盖现有输出。</div>
      </InspectorSection>
      <InspectorSection title="容器">
        <InspectorField label="Format">
          <Select value={draft.containerFormat} onValueChange={(value) => draft.setContainerFormat(value as "mp4" | "mkv" | "mov")} disabled={draft.preserveDolbyVisionMetadata}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mp4">MP4</SelectItem>
              <SelectItem value="mkv">MKV</SelectItem>
              <SelectItem value="mov">MOV</SelectItem>
            </SelectContent>
          </Select>
        </InspectorField>
        <ToggleRow
          label="Fast Start"
          description="把 MP4 索引移动到文件头，便于边下边播。"
          checked={draft.containerFaststart}
          disabled={draft.preserveDolbyVisionMetadata || draft.containerFormat !== "mp4"}
          onCheckedChange={draft.setContainerFaststart}
        />
      </InspectorSection>
      <InspectorSection title="截取范围">
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="开始 (秒)" value={draft.clipStartSec} onChange={draft.setClipStartSec} disabled={draft.preserveDolbyVisionMetadata} />
          <NumberField label="结束 (秒)" value={draft.clipEndSec} onChange={draft.setClipEndSec} disabled={draft.preserveDolbyVisionMetadata} />
        </div>
        <div className="text-[11px] text-muted-foreground">源时长：{draft.videoMetadata?.durationSec?.toFixed(3) ?? "-"} 秒</div>
      </InspectorSection>
    </div>
  );
}

/** AV1 软件编码器特有的高级参数。 */
function Av1Inspector() {
  const draft = useTaskDraft();
  return (
    <InspectorSection title="AV1 编码器参数" className="mt-3">
      {draft.formEncoder === "libaom-av1" ? (
        <>
          <TextField label="cpu-used" value={draft.av1CpuUsed} onChange={draft.setAv1CpuUsed} inputMode="numeric" />
          <ToggleRow label="row-mt" description="启用行级多线程。" checked={draft.av1RowMt} onCheckedChange={draft.setAv1RowMt} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Tile Columns" value={draft.av1TileColumns} onChange={draft.setAv1TileColumns} inputMode="numeric" />
            <TextField label="Tile Rows" value={draft.av1TileRows} onChange={draft.setAv1TileRows} inputMode="numeric" />
          </div>
        </>
      ) : draft.formEncoder === "svtav1" ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Tune" value={draft.av1SvtTune} onChange={draft.setAv1SvtTune} inputMode="numeric" />
          <TextField label="Film Grain" value={draft.av1FilmGrain} onChange={draft.setAv1FilmGrain} inputMode="numeric" />
        </div>
      ) : (
        <DependencyHint tone="success">当前硬件编码器使用运行时默认高级参数。</DependencyHint>
      )}
    </InspectorSection>
  );
}

/** 检查器内有标题的参数分组。 */
function InspectorSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-3 rounded-md border bg-muted/10 p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** 带可选依赖提示的表单字段。 */
function InspectorField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="flex items-center justify-between gap-2 text-muted-foreground">
        <span>{label}</span>{hint ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** 文本或数值字符串输入。 */
function TextField({
  label,
  value,
  onChange,
  inputMode,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "text" | "numeric" | "decimal";
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input className={INPUT_CLASS} value={value} inputMode={inputMode} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** 直接写入数字状态的输入。 */
function NumberField({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input className={INPUT_CLASS} type="number" min={0} step="0.001" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

/** 带说明的开关行。 */
function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-background/40 p-2.5">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />
    </div>
  );
}

/** 只读媒体字段。 */
function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium" title={value}>{value}</dd>
    </div>
  );
}

/** 参数依赖和执行事实提示。 */
function DependencyHint({ children, tone }: { children: ReactNode; tone: "success" | "warning" }) {
  const className = tone === "success"
    ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
    : "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300";
  return <div className={`rounded-md border px-3 py-2 text-[11px] leading-5 ${className}`}>{children}</div>;
}

import { useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CheckCircle2,
  CircleAlert,
  FileVideo2,
  FolderKanban,
  Library,
  RefreshCw,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import { OutputValidationBar } from "../components/workbench/OutputValidationBar";
import { ParameterInspector } from "../components/workbench/ParameterInspector";
import { SourceSummaryStrip } from "../components/workbench/SourceSummaryStrip";
import { useTaskDraft } from "../context/TaskDraftContext";
import { useSourceDropTarget } from "../hooks/useSourceDropTarget";
import { useI18n } from "../i18n/I18nProvider";
import {
  DETACHED_PREVIEW_UPDATE_EVENT,
  buildDetachedPreviewPayload,
  type DetachedPreviewPayload,
  writeDetachedPreviewPayload,
} from "../lib/detachedPreview";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { buildWorkbenchValidationIssues } from "../lib/workbenchPolicy";
import type {
  CompareImageOrder,
  ComparePreviewRuntime,
  EncoderCapability,
  FfmpegProbeResult,
} from "../types/workbench";

type ProfessionalWorkbenchPageProps = {
  filteredEncoders: EncoderCapability[];
  selectedEncoderCapability?: EncoderCapability;
  ffmpegProbe: FfmpegProbeResult | null;
  onOpenTemplates: () => void;
  onOpenJobs: () => void;
  onEnqueue: () => Promise<void>;
  onSaveTemplate: (input: { name: string; tags: string[] }) => Promise<void>;
};

const INITIAL_PREVIEW_RUNTIME: ComparePreviewRuntime = {
  previewState: "idle",
  previewSpeed: undefined,
  estimatedTranscodeSpeed: undefined,
  previewError: undefined,
  degradedFromTwoPass: false,
  degradedFromDolbyVision: false,
  degradedFromSdrTonemap: false,
  isFullscreen: false,
  currentTimeSec: 0,
  durationSec: 0,
  currentFrame: undefined,
};

/** 独立系统全屏预览窗口 label。 */
const DETACHED_PREVIEW_WINDOW_LABEL = "preview-detached";

/**
 * 锁定独立预览窗口的系统窗口能力。
 * @param previewWindow 需要约束的独立预览窗口
 */
async function lockDetachedPreviewWindow(previewWindow: WebviewWindow) {
  // 先禁用缩放按钮，再禁用调整尺寸，避免 macOS 因不可调整而忽略缩放状态。
  await previewWindow.setMaximizable(false).catch(() => {});
  await previewWindow.setMinimizable(false).catch(() => {});
  await previewWindow.setResizable(false).catch(() => {});
  await previewWindow.setFullscreen(true).catch(() => {});
}

/**
 * 统一的专业转码工作台：素材、参数、预览证据和入队动作保持在同一上下文。
 */
export function ProfessionalWorkbenchPage({
  filteredEncoders,
  selectedEncoderCapability,
  ffmpegProbe,
  onOpenTemplates,
  onOpenJobs,
  onEnqueue,
  onSaveTemplate,
}: ProfessionalWorkbenchPageProps) {
  const { t } = useI18n();
  const draft = useTaskDraft();
  const [splitMode, setSplitMode] = useState<"vertical" | "horizontal">("vertical");
  const [splitterPosition, setSplitterPosition] = useState(0.5);
  const [compareOrder, setCompareOrder] = useState<CompareImageOrder>("source-first");
  const [previewRuntime, setPreviewRuntime] = useState(INITIAL_PREVIEW_RUNTIME);
  const previewRuntimeRef = useRef(INITIAL_PREVIEW_RUNTIME);
  const [detachedPreviewError, setDetachedPreviewError] = useState<string | null>(null);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const { isDragOver, dropNotice, clearDropNotice } = useSourceDropTarget(draft.setSourceFilePath);
  const hasReadySource = Boolean(
    draft.sourceFilePath.trim() &&
      draft.videoMetadata &&
      draft.videoMetadata.inputFile.trim() === draft.sourceFilePath.trim(),
  );
  const runtimeState = ffmpegProbe === null ? "pending" : ffmpegProbe.ffmpegFound ? "ready" : "failed";
  const issues = buildWorkbenchValidationIssues({
    sourceFilePath: draft.sourceFilePath,
    metadata: draft.videoMetadata,
    snapshot: draft.taskDraftSnapshot,
    selectedEncoderCapability,
    ffmpegProbe,
  });

  /**
   * 同步预览运行态，并保留 ref 供独立窗口读取最新帧。
   * @param value 子组件回传的预览运行态
   */
  function handlePreviewRuntimeChange(value: ComparePreviewRuntime) {
    previewRuntimeRef.current = value;
    setPreviewRuntime(value);
  }

  /**
   * 打开或唤起独立系统全屏预览窗口。
   * @param runtimeOverride 用户点击放大按钮时由预览组件同步提供的最新运行态
   */
  async function openDetachedPreviewWindow(runtimeOverride?: ComparePreviewRuntime) {
    if (!draft.sourceFilePath) {
      setDetachedPreviewError(t("preview.detached.needSource"));
      return;
    }

    if (!isTauriRuntime()) {
      // 普通浏览器没有 Tauri 窗口 API，必须明确反馈而不是静默退化成页面内全屏。
      setDetachedPreviewError(t("workbench.detached.browserUnavailable"));
      return;
    }

    const latestRuntime = runtimeOverride ?? previewRuntimeRef.current;
    const payload: DetachedPreviewPayload = buildDetachedPreviewPayload({
      sourceFile: draft.sourceFilePath,
      sourceDurationSec: draft.videoMetadata?.durationSec,
      sourceFps: draft.videoMetadata?.video?.fps,
      sourceHdrType: draft.videoMetadata?.video?.hdrType,
      sourceColorPrimaries: draft.videoMetadata?.video?.colorPrimaries,
      sourceColorTransfer: draft.videoMetadata?.video?.colorTransfer,
      sourceColorSpace: draft.videoMetadata?.video?.colorSpace,
      sourceColorRange: draft.videoMetadata?.video?.colorRange,
      taskDraftSnapshot: draft.taskDraftSnapshot,
      splitMode,
      splitterPosition,
      compareOrder,
      currentTimeSec: latestRuntime.currentTimeSec,
      currentFrame: latestRuntime.currentFrame,
    });

    setDetachedPreviewError(null);
    writeDetachedPreviewPayload(payload);

    try {
      const existingWindow = await WebviewWindow.getByLabel(DETACHED_PREVIEW_WINDOW_LABEL);
      if (existingWindow) {
        // 已存在的独立窗口只同步快照并切回系统全屏，避免重复创建窗口。
        await existingWindow.emit(DETACHED_PREVIEW_UPDATE_EVENT, payload);
        await existingWindow.setFocus();
        await lockDetachedPreviewWindow(existingWindow);
        return;
      }

      const detachedUrl = new URL(window.location.href);
      detachedUrl.pathname = "/";
      detachedUrl.search = "detachedPreview=1";
      detachedUrl.hash = "";

      const previewWindow = new WebviewWindow(DETACHED_PREVIEW_WINDOW_LABEL, {
        url: detachedUrl.toString(),
        title: "Encode Lab Preview",
        width: 1280,
        height: 720,
        minWidth: 800,
        minHeight: 450,
        center: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        decorations: true,
        focus: true,
        maximized: true,
        fullscreen: true,
      });

      void previewWindow.once("tauri://created", () => {
        // 窗口创建成功后再补发一次快照，覆盖 localStorage 读取时序差异。
        void previewWindow.emit(DETACHED_PREVIEW_UPDATE_EVENT, payload);
        void lockDetachedPreviewWindow(previewWindow);
      });
      void previewWindow.once("tauri://error", (event) => {
        setDetachedPreviewError(t("preview.detached.createFailed", { message: String(event.payload) }));
      });
    } catch (error) {
      setDetachedPreviewError(error instanceof Error ? error.message : String(error));
    }
  }

  /** 将校验后的当前草稿加入真实桌面队列。 */
  async function enqueueCurrentDraft() {
    if (isEnqueuing) {
      return;
    }
    setIsEnqueuing(true);
    setEnqueueError(null);
    try {
      await onEnqueue();
    } catch (error) {
      setEnqueueError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEnqueuing(false);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-col gap-3 xl:h-[calc(100vh-1.5rem)] xl:overflow-hidden">
      {isDragOver ? (
        <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-center shadow-2xl backdrop-blur-sm">
          <div>
            <FileVideo2 className="mx-auto size-10 text-primary" aria-hidden="true" />
            <div className="mt-3 text-lg font-semibold">{t("workbench.drop.replaceTitle")}</div>
            <div className="mt-1 text-sm text-muted-foreground">{t("workbench.drop.preserveHint")}</div>
          </div>
        </div>
      ) : null}

      {dropNotice ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span>{dropNotice}</span>
          <Button size="sm" variant="ghost" onClick={clearDropNotice}>{t("common.gotIt")}</Button>
        </div>
      ) : null}

      {!hasReadySource ? (
        <EmptySourceWorkspace
          sourceFilePath={draft.sourceFilePath}
          loading={draft.videoMetadataLoading}
          error={draft.videoMetadataError}
          ffmpegReady={Boolean(ffmpegProbe?.ffmpegFound && ffmpegProbe.ffprobeFound)}
          onSourcePathChange={draft.setSourceFilePath}
          onPickSource={() => void draft.pickSourceFile()}
          onRetry={() => void draft.retryVideoMetadata()}
        />
      ) : (
        <>
          <header className="flex shrink-0 flex-col gap-3 border-b px-1 pb-2.5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t("workbench.sourceLabel")}</span>
              <span className="max-w-72 truncate font-medium" title={draft.sourceFilePath}>{draft.sourceFilePath.split(/[\\/]/).pop()}</span>
              <span className="text-border">/</span>
              <span className="text-muted-foreground">{t("workbench.presetLabel")}</span>
              <button type="button" className="rounded-md border bg-background px-2 py-1 font-medium text-primary transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40" onClick={onOpenTemplates}>
                {draft.activeTemplateName}
              </button>
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary">
                <CheckCircle2 className="size-3" aria-hidden="true" />{t("workbench.presetApplied")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={onOpenTemplates}>
                <Library data-icon="inline-start" aria-hidden="true" />{t("workbench.openPresetLibrary")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onOpenJobs}>
                <FolderKanban data-icon="inline-start" aria-hidden="true" />{t("workbench.openJobs")}
              </Button>
              <span className={`ml-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${runtimeState === "ready" ? "text-emerald-600 dark:text-emerald-400" : runtimeState === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                <span className={`size-1.5 rounded-full ${runtimeState === "ready" ? "bg-emerald-500" : runtimeState === "failed" ? "bg-destructive" : "bg-muted-foreground/50"}`} aria-hidden="true" />
                {runtimeState === "ready"
                  ? t("workbench.runtime.ready")
                  : runtimeState === "failed"
                    ? t("workbench.runtime.error")
                    : t("workbench.runtime.probing")}
              </span>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="min-w-0 space-y-3 xl:overflow-y-auto xl:pr-1">
              <SourceSummaryStrip
                sourceFilePath={draft.sourceFilePath}
                metadata={draft.videoMetadata}
                loading={draft.videoMetadataLoading}
                error={draft.videoMetadataError}
                activeTemplateName={draft.activeTemplateName}
                onPickSource={() => void draft.pickSourceFile()}
                onRetry={() => void draft.retryVideoMetadata()}
              />

              <section className="overflow-hidden rounded-lg border bg-card/70" aria-labelledby="preview-heading">
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
                  <div>
                    <h2 id="preview-heading" className="text-sm font-semibold">{t("workbench.preview.title")}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("workbench.preview.description")}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`size-2 rounded-full ${previewRuntime.previewError ? "bg-destructive" : previewRuntime.previewState === "running" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                    <span className="text-muted-foreground">{formatPreviewState(previewRuntime, t)}</span>
                  </div>
                </div>
                <div className="p-2">
                  <ComparePreviewPlayer
                    sourceFile={draft.sourceFilePath}
                    sourceDurationSec={draft.videoMetadata?.durationSec}
                    sourceFps={draft.videoMetadata?.video?.fps}
                    sourceHdrType={draft.videoMetadata?.video?.hdrType}
                    sourceColorPrimaries={draft.videoMetadata?.video?.colorPrimaries}
                    sourceColorTransfer={draft.videoMetadata?.video?.colorTransfer}
                    sourceColorSpace={draft.videoMetadata?.video?.colorSpace}
                    sourceColorRange={draft.videoMetadata?.video?.colorRange}
                    taskDraftSnapshot={draft.taskDraftSnapshot}
                    splitMode={splitMode}
                    splitterPosition={splitterPosition}
                    compareOrder={compareOrder}
                    onSplitModeChange={setSplitMode}
                    onSplitterPositionChange={setSplitterPosition}
                    onCompareOrderChange={setCompareOrder}
                    onRuntimeChange={handlePreviewRuntimeChange}
                    onFullscreenButtonClick={(value) => void openDetachedPreviewWindow(value)}
                  />
                </div>
                {detachedPreviewError ? (
                  <div
                    className="mx-2 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                    role="alert"
                  >
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{detachedPreviewError}</span>
                  </div>
                ) : null}
              </section>

              {previewRuntime.degradedFromTwoPass || previewRuntime.degradedFromDolbyVision || previewRuntime.degradedFromSdrTonemap ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{t("workbench.preview.degraded")}</span>
                </div>
              ) : null}

              <OutputValidationBar
                sourceFilePath={draft.sourceFilePath}
                metadata={draft.videoMetadata}
                snapshot={draft.taskDraftSnapshot}
                issueCount={issues.length}
              />
            </div>

            <ParameterInspector
              filteredEncoders={filteredEncoders}
              selectedEncoderCapability={selectedEncoderCapability}
              ffmpegProbe={ffmpegProbe}
              issues={issues}
              isEnqueuing={isEnqueuing}
              enqueueError={enqueueError}
              onOpenTemplates={onOpenTemplates}
              onEnqueue={enqueueCurrentDraft}
              onSaveTemplate={onSaveTemplate}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** 未导入素材时的单一任务入口。 */
function EmptySourceWorkspace({
  sourceFilePath,
  loading,
  error,
  ffmpegReady,
  onSourcePathChange,
  onPickSource,
  onRetry,
}: {
  sourceFilePath: string;
  loading: boolean;
  error: string | null;
  ffmpegReady: boolean;
  onSourcePathChange: (value: string) => void;
  onPickSource: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="grid min-h-[calc(100vh-5rem)] place-items-center px-4 py-10">
      <section className="w-full max-w-2xl rounded-lg border bg-card/70 p-6 text-center shadow-sm">
        <FileVideo2 className="mx-auto size-10 text-primary" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold">{t("workbench.empty.title")}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          {t("workbench.empty.description")}
        </p>
        <div className="mx-auto mt-5 grid max-w-xl gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            className="h-10 rounded-md border bg-background px-3 text-left text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            value={sourceFilePath}
            onChange={(event) => onSourcePathChange(event.target.value)}
            placeholder={t("workbench.empty.pathPlaceholder")}
            aria-label={t("workbench.empty.pathLabel")}
          />
          <Button onClick={onPickSource}>
            <FileVideo2 data-icon="inline-start" aria-hidden="true" />{t("workbench.empty.pick")}
          </Button>
        </div>
        {loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />{t("workbench.empty.analyzing")}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive" role="alert">
            <div>{error}</div>
            <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>{t("source.retry")}</Button>
          </div>
        ) : null}
        <div className={`mt-5 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${ffmpegReady ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          <span className={`size-2 rounded-full ${ffmpegReady ? "bg-emerald-500" : "bg-destructive"}`} aria-hidden="true" />
          {ffmpegReady ? t("workbench.empty.runtimeReady") : t("workbench.empty.runtimeUnavailable")}
        </div>
      </section>
    </div>
  );
}

/** 把内部预览状态翻译为简洁状态文本。 */
function formatPreviewState(runtime: ComparePreviewRuntime, t: ReturnType<typeof useI18n>["t"]) {
  if (runtime.previewError) return t("preview.state.error");
  const labels: Record<ComparePreviewRuntime["previewState"], string> = {
    idle: t("preview.state.idle"),
    warming: t("preview.state.warming"),
    running: t("preview.state.running"),
    updating: t("preview.state.updating"),
    stopped: t("preview.state.stopped"),
    error: t("preview.state.error"),
  };
  return labels[runtime.previewState];
}

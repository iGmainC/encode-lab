import { useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ArrowLeft, ChevronDown, FileVideo2, FolderOpen, Send, ShieldCheck } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { FilePathActions, formatPathName } from "../components/common/FilePathActions";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import { useTaskDraft } from "../context/TaskDraftContext";
import { useI18n } from "../i18n/I18nProvider";
import {
  DETACHED_PREVIEW_UPDATE_EVENT,
  type DetachedPreviewPayload,
  writeDetachedPreviewPayload,
} from "../lib/detachedPreview";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type {
  CompareImageOrder,
  ComparePreviewRuntime,
  JobHistory,
  TaskDraftSnapshot,
  VideoMetadataResult,
} from "../types/workbench";

type Props = {
  jobs: JobHistory[];
  splitMode: "vertical" | "horizontal";
  setSplitMode: (mode: "vertical" | "horizontal") => void;
  splitterPosition: number;
  setSplitterPosition: (value: number) => void;
  compareOrder: CompareImageOrder;
  setCompareOrder: (value: CompareImageOrder) => void;
  onBackConfig: () => void;
  onBackSource: () => void;
  onOpenTemplates: () => void;
  onOpenJobs: () => void;
  onEnqueue: () => Promise<void>;
};

const emptyRuntime: ComparePreviewRuntime = {
  previewState: "idle",
  previewSpeed: undefined,
  estimatedTranscodeSpeed: undefined,
  previewError: undefined,
  degradedFromTwoPass: false,
  degradedFromDolbyVision: false,
  degradedFromSdrTonemap: false,
  currentTimeSec: 0,
  durationSec: 0,
  isFullscreen: false,
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

export function PreviewPage({
  jobs,
  splitMode,
  setSplitMode,
  splitterPosition,
  setSplitterPosition,
  compareOrder,
  setCompareOrder,
  onBackConfig,
  onBackSource,
  onOpenTemplates,
  onOpenJobs,
  onEnqueue,
}: Props) {
  const { t } = useI18n();
  const {
    setStep,
    sourceFilePath,
    taskDraftSnapshot,
    videoMetadata,
    formCodec,
    formEncoder,
    formTwoPass,
  } = useTaskDraft();
  const [runtime, setRuntime] = useState<ComparePreviewRuntime>(emptyRuntime);
  const runtimeRef = useRef<ComparePreviewRuntime>(emptyRuntime);
  const [detachedPreviewError, setDetachedPreviewError] = useState<string | null>(null);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const completedJobs = jobs.filter((job) => job.status === "completed").slice(0, 3);
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const sourceSummary = buildSourceSummary(videoMetadata, sourceFilePath);
  const outputDecision = buildOutputDecision(videoMetadata, taskDraftSnapshot);
  const canUseHostActions = isTauriRuntime();
  const hasSource = sourceFilePath.trim().length > 0;
  const hasReadableSource = hasSource && Boolean(videoMetadata);
  const timelineStep = hasReadableSource ? 3 : hasSource ? 2 : 1;
  const previewDegradationCopy = buildPreviewDegradationCopy(runtime);

  /**
   * 返回任务配置页，保留当前草稿供继续调整。
   */
  const handleBackConfig = () => {
    // 预览页回退只改变流程阶段，不清空任何已配置参数。
    setStep("config");
    onBackConfig();
  };

  /**
   * 返回源文件选择页，用于重新选择输入素材。
   */
  const handleBackSource = () => {
    setStep("source");
    onBackSource();
  };

  /**
   * 同步预览运行态，并保留 ref 供打开独立窗口时读取最新帧。
   * @param value 子组件回传的预览运行态
   */
  const handleRuntimeChange = (value: ComparePreviewRuntime) => {
    runtimeRef.current = value;
    setRuntime(value);
  };

  /**
   * 加入转码队列；失败时停留在预览页并展示后端错误。
   */
  const handleEnqueue = async () => {
    if (!sourceFilePath || isEnqueuing) {
      return;
    }

    setEnqueueError(null);
    setIsEnqueuing(true);
    try {
      await onEnqueue();
      setStep("confirm");
    } catch (error) {
      // Tauri invoke 失败通常是字符串或 Error，这里统一转成可展示文案。
      setEnqueueError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEnqueuing(false);
    }
  };

  /**
   * 打开或唤起独立系统全屏预览窗口。
   */
  const openDetachedPreviewWindow = async (runtimeOverride?: ComparePreviewRuntime) => {
    if (!sourceFilePath) {
      setDetachedPreviewError(t("preview.detached.needSource"));
      return;
    }

    if (!canUseHostActions) {
      setDetachedPreviewError("浏览器预览模式不能打开独立桌面预览窗口，请在桌面应用中使用。");
      return;
    }

    const latestRuntime = runtimeOverride ?? runtimeRef.current;
    const payload: DetachedPreviewPayload = {
      sourceFile: sourceFilePath,
      sourceDurationSec: videoMetadata?.durationSec,
      sourceHdrType: videoMetadata?.video?.hdrType,
      sourceColorPrimaries: videoMetadata?.video?.colorPrimaries,
      sourceColorTransfer: videoMetadata?.video?.colorTransfer,
      sourceColorSpace: videoMetadata?.video?.colorSpace,
      sourceColorRange: videoMetadata?.video?.colorRange,
      taskDraftSnapshot: taskDraftSnapshot as TaskDraftSnapshot,
      splitMode,
      splitterPosition,
      compareOrder,
      currentTimeSec: latestRuntime.currentTimeSec,
      currentFrame: latestRuntime.currentFrame,
      updatedAt: Date.now(),
    };

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
    } catch (err) {
      setDetachedPreviewError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-5">
      <DecisionTimeline currentStep={timelineStep} hasReadableSource={hasReadableSource} />

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileVideo2 className="size-4 text-primary" aria-hidden="true" />
                源素材
              </CardTitle>
              <CardDescription>
                {hasReadableSource ? "素材已读取，当前用于预览验证。" : "先选择源素材，预览和入队才会进入可执行状态。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm">
              <FilePathActions path={sourceFilePath} emptyText="未选择源文件" />
              <div className="divide-y rounded-lg border">
                {sourceSummary.map((item) => (
                  <div key={item.label} className="grid grid-cols-[84px_1fr] gap-3 px-3 py-2">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="min-w-0 break-words font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
              <Button variant="secondary" className="w-full justify-between" onClick={handleBackSource}>
                <span className="inline-flex items-center gap-2">
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  {hasSource ? "调整源素材" : "选择源素材"}
                </span>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-base">输出意图</CardTitle>
              <CardDescription>先确认这次转码的目标，再判断参数是否值得执行。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm">
              <div className="rounded-lg border bg-primary/5 p-3">
                <div className="font-medium">线上发布副本</div>
                <div className="mt-1 text-xs text-muted-foreground">平台上传 · 快速起播 · 体积友好</div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">为什么选它</div>
                <p className="leading-6 text-muted-foreground">
                  在可见画质、交付体积和常见平台播放稳定性之间保持平衡。
                </p>
              </div>
              <Button variant="outline" className="w-full justify-between" onClick={onOpenTemplates}>
                更换方案
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </aside>

        <section className="min-w-0">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4 border-b p-4">
              <div>
                <CardTitle>{t("preview.card.title")}</CardTitle>
                <CardDescription>{t("preview.card.description")}</CardDescription>
              </div>
              <Badge
                className={hasReadableSource ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""}
                variant={hasReadableSource ? "default" : "secondary"}
              >
                <ShieldCheck className="mr-1 size-3.5" aria-hidden="true" />
                {hasReadableSource ? "预览就绪" : "等待素材"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <ComparePreviewPlayer
                sourceFile={sourceFilePath}
                sourceDurationSec={videoMetadata?.durationSec}
                sourceHdrType={videoMetadata?.video?.hdrType}
                sourceColorPrimaries={videoMetadata?.video?.colorPrimaries}
                sourceColorTransfer={videoMetadata?.video?.colorTransfer}
                sourceColorSpace={videoMetadata?.video?.colorSpace}
                sourceColorRange={videoMetadata?.video?.colorRange}
                taskDraftSnapshot={taskDraftSnapshot as TaskDraftSnapshot}
                splitMode={splitMode}
                splitterPosition={splitterPosition}
                compareOrder={compareOrder}
                onSplitModeChange={setSplitMode}
                onSplitterPositionChange={setSplitterPosition}
                onCompareOrderChange={setCompareOrder}
                onRuntimeChange={handleRuntimeChange}
                onFullscreenButtonClick={(value) => void openDetachedPreviewWindow(value)}
              />

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                <div className="font-medium">{previewDegradationCopy.title}</div>
                <div className="mt-1 text-primary/80">{previewDegradationCopy.detail}</div>
              </div>
              {enqueueError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {enqueueError}
                </div>
              ) : null}
              {detachedPreviewError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {detachedPreviewError}
                </div>
              ) : null}
              {!canUseHostActions ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  浏览器预览模式只展示样例数据，不会发送队列、创建桌面窗口或写入本机数据。
                </div>
              ) : null}
              <div className="grid gap-3 text-sm md:grid-cols-4">
                <MetricTile label="当前时间" value={`${runtime.currentTimeSec.toFixed(2)}s`} />
                <MetricTile label="总时长" value={`${runtime.durationSec.toFixed(2)}s`} />
                <MetricTile label="分割线" value={`${(splitterPosition * 100).toFixed(0)}%`} />
                <MetricTile
                  label="对比方向"
                  value={compareOrder === "source-first" ? "原始优先" : "预览优先"}
                />
              </div>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm transition hover:bg-muted/50"
                onClick={handleBackConfig}
              >
                <span className="font-medium">高级编码细节</span>
                <span className="text-muted-foreground">
                  {formCodec.toUpperCase()} · {formEncoder} · {formTwoPass ? "2-pass" : "single pass"}
                </span>
              </button>
            </CardContent>
          </Card>
        </section>

        <aside>
          <Card className="shadow-sm">
            <CardHeader className="border-b p-4">
              <CardTitle>输出决策</CardTitle>
              <CardDescription>确认体积、质量、耗时和输出位置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 text-sm">
              <DecisionRow
                label="预计文件体积"
                value={outputDecision.predictedSize}
                detail={outputDecision.sizeDetail}
                badge="良好"
                badgeClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              />
              <DecisionRow
                label="质量信心"
                value={outputDecision.quality}
                detail="预计在多数观看场景下保持稳定观感。"
                badge="高"
                badgeClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              />
              <DecisionRow
                label="预计转码耗时"
                value={outputDecision.estimatedTime}
                detail={
                  runtime.estimatedTranscodeSpeed
                    ? `${runtime.estimatedTranscodeSpeed.toFixed(2)}x 预览估算`
                    : "基于当前机器和编码器估算。"
                }
                badge="正常"
                badgeClassName="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              />
              <div className="space-y-2 border-t pt-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">输出位置</div>
                <div className="flex items-start gap-2">
                  <FolderOpen className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="break-words font-medium">{outputDecision.outputDir}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{outputDecision.fileName}</div>
                  </div>
                </div>
              </div>
              <Button
                className="h-11 w-full"
                disabled={!sourceFilePath || isEnqueuing || !canUseHostActions}
                onClick={() => void handleEnqueue()}
              >
                <Send data-icon="inline-start" aria-hidden="true" />
                {isEnqueuing ? t("preview.enqueuing") : t("preview.confirm")}
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={!sourceFilePath || !canUseHostActions}
                onClick={() => void openDetachedPreviewWindow()}
              >
                {t("preview.fullscreen")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">任务会在确认后加入本机队列。</p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 p-4">
            <div>
              <CardTitle>队列健康度</CardTitle>
              <CardDescription>下一条任务进入本机队列前的执行状态。</CardDescription>
            </div>
            <Badge variant={activeJobs.length > 0 ? "secondary" : "default"}>
              {activeJobs.length > 0 ? "忙碌" : "良好"}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 pt-0 text-sm sm:grid-cols-2">
            <MetricTile label="运行中" value={String(activeJobs.filter((job) => job.status === "running").length)} />
            <MetricTile label="等待中" value={String(activeJobs.filter((job) => job.status === "queued").length)} />
            <MetricTile label="预览状态" value={runtime.previewState} />
            <MetricTile label="速度" value={runtime.previewSpeed ? `${runtime.previewSpeed.toFixed(2)}x` : "-"} />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b p-4">
            <div>
              <CardTitle>最近完成的输出</CardTitle>
              <CardDescription>把完成任务当成复盘依据，而不只是历史记录。</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onOpenJobs}>
              查看全部结果
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <RecentOutputs jobs={completedJobs} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DecisionTimeline({ currentStep, hasReadableSource }: { currentStep: number; hasReadableSource: boolean }) {
  const steps = [
    { title: "选择源文件", detail: hasReadableSource ? "源文件已读取" : "等待源文件" },
    { title: "配置参数", detail: hasReadableSource ? "沿用当前草稿" : "读取后调整" },
    { title: "预览校验", detail: "对比当前帧" },
    { title: "确认任务", detail: "加入队列" },
  ];

  return (
    <Card className="shadow-sm">
      <CardContent className="grid gap-3 p-4 md:grid-cols-4">
        {steps.map((item, index) => {
          const stepNumber = index + 1;
          const isDone = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;
          return (
            <div key={item.title} className="flex items-center gap-3">
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isDone
                      ? "border-primary/40 text-primary"
                      : "border-border text-muted-foreground"
                }`}
              >
                {isDone ? "✓" : stepNumber}
              </div>
              <div className="min-w-0">
                <div className={isCurrent ? "font-semibold text-primary" : "font-medium"}>{item.title}</div>
                <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * 生成预览降级说明，避免用户把单帧预览误认为完整正式转码验证。
 * @param runtime 当前预览运行态
 * @returns 预览页提示卡标题与说明
 */
function buildPreviewDegradationCopy(runtime: ComparePreviewRuntime) {
  if (runtime.degradedFromSdrTonemap) {
    return {
      title: "HDR/Dolby Vision SDR 预览映射不可用，已降级为普通预览。",
      detail: "Dolby Vision 需要 libplacebo，HDR10/HLG 需要 libplacebo 或 zscale+tonemap；当前 FFmpeg 不满足对应链路，正式转码不受该预览降级影响。",
    };
  }

  if (runtime.degradedFromTwoPass && runtime.degradedFromDolbyVision) {
    return {
      title: "2-pass 与 Dolby Vision 元数据保留会在预览中降级。",
      detail: "正式转码仍会按当前参数执行完整 2-pass 与 DV 元数据保留链路。",
    };
  }

  if (runtime.degradedFromDolbyVision) {
    return {
      title: "Dolby Vision 元数据保留不会进入单帧预览。",
      detail: "当前画面对比只验证可见帧参数，正式转码仍会执行 DV 元数据保留。",
    };
  }

  if (runtime.degradedFromTwoPass) {
    return {
      title: "2-pass 预览会使用快速单遍样本进行画面对比。",
      detail: "正式转码仍会按当前参数执行完整 2-pass。",
    };
  }

  return {
    title: "当前预览使用单帧参数样本进行画面对比。",
    detail: "正式转码会按完整任务参数执行，预览用于快速确认当前帧观感。",
  };
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function DecisionRow({
  label,
  value,
  detail,
  badge,
  badgeClassName,
}: {
  label: string;
  value: string;
  detail: string;
  badge: string;
  badgeClassName: string;
}) {
  return (
    <div className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted-foreground">{label}</div>
        <Badge className={badgeClassName}>{badge}</Badge>
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function RecentOutputs({ jobs }: { jobs: JobHistory[] }) {
  if (jobs.length === 0) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        完成任务会在这里展示体积变化和复盘线索。
      </div>
    );
  }

  return (
    <div className="divide-y text-sm">
      {jobs.map((job) => (
        <div key={job.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px]">
          <div className="min-w-0">
            <div className="truncate font-medium">{job.name || formatPathName(job.outputFile)}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{formatPathName(job.outputFile)}</div>
          </div>
          <Badge className="w-max bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            已完成
          </Badge>
          <div className="font-medium text-emerald-600 dark:text-emerald-400">{formatPercent(job.sizeChangePercent)}</div>
          <div className="text-muted-foreground">{formatDate(job.endedAt ?? job.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * 生成预览页左侧的素材摘要。
 * @param videoMetadata 当前素材元数据
 * @param sourceFilePath 源文件路径
 * @returns 可展示的字段行
 */
function buildSourceSummary(videoMetadata: VideoMetadataResult | null, sourceFilePath: string) {
  const video = videoMetadata?.video;
  const audio = videoMetadata?.audio;
  return [
    { label: "格式", value: videoMetadata?.containerFormat ?? formatPathName(sourceFilePath) ?? "-" },
    {
      label: "视频",
      value:
        video?.width && video?.height
          ? `${video.width} x ${video.height} · ${formatFps(video.fps)} fps`
          : "-",
    },
    {
      label: "编码",
      value: [video?.codecName, video?.pixFmt, video?.bitDepth ? `${video.bitDepth}-bit` : ""]
        .filter(Boolean)
        .join(" · ") || "-",
    },
    {
      label: "音频",
      value: [audio?.codecName, audio?.channelLayout, audio?.sampleRate ? `${audio.sampleRate} Hz` : ""]
        .filter(Boolean)
        .join(" · ") || "-",
    },
    { label: "时长", value: formatDuration(videoMetadata?.durationSec) },
    { label: "体积", value: formatBytes(videoMetadata?.sizeBytes) },
  ];
}

/**
 * 根据当前素材和参数生成输出决策摘要。
 * @param videoMetadata 当前素材元数据
 * @param snapshot 当前参数草稿快照
 */
function buildOutputDecision(videoMetadata: VideoMetadataResult | null, snapshot: TaskDraftSnapshot) {
  const inputSize = videoMetadata?.sizeBytes ?? 0;
  const lower = inputSize > 0 ? inputSize * 0.16 : 0;
  const upper = inputSize > 0 ? inputSize * 0.22 : 0;
  const fileName = buildOutputFileName(videoMetadata?.inputFile, snapshot);
  return {
    predictedSize: inputSize > 0 ? `${formatBytes(lower)} - ${formatBytes(upper)}` : "-",
    sizeDetail: inputSize > 0 ? `预计比源文件小 78% - 84%（源文件 ${formatBytes(inputSize)}）。` : "选择源文件后估算体积。",
    quality: snapshot.video.bitrateMode === "CRF" ? `${100 - Math.min(51, snapshot.video.crf ?? 23)} 分信心` : "高信心",
    estimatedTime: snapshot.video.enableTwoPass ? "18 - 24 分钟" : "9 - 14 分钟",
    outputDir: snapshot.output.dir || "默认输出目录",
    fileName,
  };
}

function buildOutputFileName(inputFile: string | undefined, snapshot: TaskDraftSnapshot) {
  const inputName = formatPathName(inputFile ?? "source");
  const baseName = inputName.replace(/\.[^.]+$/, "") || "output";
  return `${baseName}_${snapshot.name || "publish"}.${snapshot.container.format}`;
}

function formatFps(value?: number) {
  return typeof value === "number" ? value.toFixed(3).replace(/\.?0+$/, "") : "-";
}

function formatDuration(value?: number) {
  if (typeof value !== "number" || value <= 0) {
    return "-";
  }
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${minutes}m ${seconds}s`
    : `${minutes}m ${seconds}s`;
}

function formatBytes(value?: number | null) {
  if (typeof value !== "number" || value <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${nextValue.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

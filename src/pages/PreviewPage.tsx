import { useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import { PreviewInspector } from "../components/workbench/PreviewInspector";
import { useTaskDraft } from "../context/TaskDraftContext";
import {
  DETACHED_PREVIEW_UPDATE_EVENT,
  type DetachedPreviewPayload,
  writeDetachedPreviewPayload,
} from "../lib/detachedPreview";
import type { CompareImageOrder, ComparePreviewRuntime, TaskDraftSnapshot } from "../types/workbench";

type Props = {
  splitMode: "vertical" | "horizontal";
  setSplitMode: (mode: "vertical" | "horizontal") => void;
  splitterPosition: number;
  setSplitterPosition: (value: number) => void;
  compareOrder: CompareImageOrder;
  setCompareOrder: (value: CompareImageOrder) => void;
  onEnqueue: () => Promise<void>;
};

const emptyRuntime: ComparePreviewRuntime = {
  previewState: "idle",
  previewSpeed: undefined,
  estimatedTranscodeSpeed: undefined,
  previewError: undefined,
  degradedFromTwoPass: false,
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
  splitMode,
  setSplitMode,
  splitterPosition,
  setSplitterPosition,
  compareOrder,
  setCompareOrder,
  onEnqueue,
}: Props) {
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
      setStep("enqueue");
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
      setDetachedPreviewError("请先选择源视频后再打开独立预览窗口。");
      return;
    }

    const latestRuntime = runtimeOverride ?? runtimeRef.current;
    const payload: DetachedPreviewPayload = {
      sourceFile: sourceFilePath,
      sourceDurationSec: videoMetadata?.durationSec,
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
        setDetachedPreviewError(`独立预览窗口创建失败：${String(event.payload)}`);
      });
    } catch (err) {
      setDetachedPreviewError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>按帧图片对比预览</CardTitle>
            <CardDescription>时间轴定位当前帧，源帧与参数预览帧通过分割线叠放对比。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ComparePreviewPlayer
              sourceFile={sourceFilePath}
              sourceDurationSec={videoMetadata?.durationSec}
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

            <div className="rounded-2xl border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">预览控制区</div>
                  <p className="text-sm text-muted-foreground">进入队列前，在这里确认当前时间点、分割方式和预览状态是否符合预期。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={!sourceFilePath}
                    onClick={() => void openDetachedPreviewWindow()}
                  >
                    系统全屏预览
                  </Button>
                  <Button
                    disabled={!sourceFilePath || isEnqueuing}
                    onClick={() => void handleEnqueue()}
                  >
                    {isEnqueuing ? "加入中..." : "加入队列"}
                  </Button>
                </div>
              </div>
              {enqueueError ? (
                <div className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {enqueueError}
                </div>
              ) : null}
              {detachedPreviewError ? (
                <div className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {detachedPreviewError}
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border p-3 text-sm">currentTime: {runtime.currentTimeSec.toFixed(2)}s</div>
                <div className="rounded-2xl border p-3 text-sm">duration: {runtime.durationSec.toFixed(2)}s</div>
                <div className="rounded-2xl border p-3 text-sm">
                  splitter: {(splitterPosition * 100).toFixed(0)}%
                </div>
                <div className="rounded-2xl border p-3 text-sm md:col-span-3">
                  compare: {compareOrder === "source-first" ? "原始在左/上，转码后在右/下" : "转码后在左/上，原始在右/下"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <PreviewInspector
        splitMode={splitMode}
        videoMetadata={videoMetadata}
        codec={formCodec}
        encoder={formEncoder}
        twoPass={formTwoPass}
        runtime={runtime}
      />
    </div>
  );
}

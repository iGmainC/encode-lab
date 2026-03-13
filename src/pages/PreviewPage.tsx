import { useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ComparePreviewPlayer } from "../components/workbench/ComparePreviewPlayer";
import { PreviewInspector } from "../components/workbench/PreviewInspector";
import { useTaskDraft } from "../context/TaskDraftContext";
import type { ComparePreviewRuntime, TaskDraftSnapshot } from "../types/workbench";

type Props = {
  splitMode: "vertical" | "horizontal";
  setSplitMode: (mode: "vertical" | "horizontal") => void;
  splitterPosition: number;
  setSplitterPosition: (value: number) => void;
};

const emptyRuntime: ComparePreviewRuntime = {
  previewState: "idle",
  previewSpeed: undefined,
  estimatedTranscodeSpeed: undefined,
  degradedFromTwoPass: false,
  currentTimeSec: 0,
  durationSec: 0,
  isFullscreen: false,
};

export function PreviewPage({
  splitMode,
  setSplitMode,
  splitterPosition,
  setSplitterPosition,
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

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>单播放器对比预览</CardTitle>
            <CardDescription>主视频负责时间轴和播放控制，预览层实时接收最新渲染帧并覆盖显示。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ComparePreviewPlayer
              sourceFile={sourceFilePath}
              taskDraftSnapshot={taskDraftSnapshot as TaskDraftSnapshot}
              splitMode={splitMode}
              splitterPosition={splitterPosition}
              onSplitModeChange={setSplitMode}
              onSplitterPositionChange={setSplitterPosition}
              onRuntimeChange={setRuntime}
            />

            <div className="rounded-2xl border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">预览控制区</div>
                  <p className="text-sm text-muted-foreground">进入队列前，在这里确认当前时间点、分割方式和预览状态是否符合预期。</p>
                </div>
                <Button
                  onClick={() => {
                    setStep("enqueue");
                  }}
                >
                  加入队列
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border p-3 text-sm">currentTime: {runtime.currentTimeSec.toFixed(2)}s</div>
                <div className="rounded-2xl border p-3 text-sm">duration: {runtime.durationSec.toFixed(2)}s</div>
                <div className="rounded-2xl border p-3 text-sm">
                  splitter: {(splitterPosition * 100).toFixed(0)}%
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

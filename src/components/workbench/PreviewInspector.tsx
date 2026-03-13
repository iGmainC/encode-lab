import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import type { ComparePreviewRuntime, VideoMetadataResult } from "../../types/workbench";

type Props = {
  splitMode: "vertical" | "horizontal";
  videoMetadata: VideoMetadataResult | null;
  codec: string;
  encoder: string;
  twoPass: boolean;
  runtime: ComparePreviewRuntime;
};

export function PreviewInspector({ splitMode, videoMetadata, codec, encoder, twoPass, runtime }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>预览状态</CardTitle>
          <CardDescription>预览会优先贴近真实转码能力，但仍然是近实时近似。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{splitMode === "vertical" ? "纵向分割" : "横向分割"}</Badge>
            <Badge variant="outline">{codec.toUpperCase()}</Badge>
            <Badge variant="outline">{encoder}</Badge>
          </div>
          <Alert>
            <AlertTitle>2-pass 预览规则</AlertTitle>
            <AlertDescription>
              {runtime.degradedFromTwoPass || twoPass
                ? "当前任务启用了 2-pass，预览阶段已降级为 1-pass 近似结果。"
                : "当前任务以单 pass 预览，和正式命令更接近。"}
            </AlertDescription>
          </Alert>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border p-3">state: {runtime.previewState}</div>
            <div className="rounded-2xl border p-3">
              previewSpeed: {runtime.previewSpeed ? `${runtime.previewSpeed.toFixed(2)}x` : "-"}
            </div>
            <div className="rounded-2xl border p-3">
              estimated: {runtime.estimatedTranscodeSpeed ? `${runtime.estimatedTranscodeSpeed.toFixed(2)}x` : "-"}
            </div>
            <div className="rounded-2xl border p-3">{runtime.isFullscreen ? "当前处于全屏模式" : "普通模式"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>源视频摘要</CardTitle>
          <CardDescription>预览页右侧固定展示素材和参数关键字段。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="rounded-2xl border p-3">分辨率: {videoMetadata?.video?.width ?? "-"} x {videoMetadata?.video?.height ?? "-"}</div>
          <div className="rounded-2xl border p-3">帧率: {videoMetadata?.video?.fps?.toFixed(2) ?? "-"}</div>
          <div className="rounded-2xl border p-3">像素格式: {videoMetadata?.video?.pixFmt ?? "-"}</div>
          <div className="rounded-2xl border p-3">HDR: {videoMetadata?.video?.hdrType ?? "-"}</div>
        </CardContent>
      </Card>
    </div>
  );
}

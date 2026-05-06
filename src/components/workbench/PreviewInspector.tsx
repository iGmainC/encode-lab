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

/**
 * 判断当前源视频是否属于明确 HDR 类型。
 * @param hdrType ffprobe 归一化后的 HDR 类型
 * @returns 明确 HDR 时返回 true
 */
function isHdrSource(hdrType?: string) {
  return hdrType === "Hdr10" || hdrType === "Hlg" || hdrType === "DolbyVision";
}

/**
 * 格式化元数据字段，避免空值在信息面板里显示为 undefined。
 * @param value 待展示的元数据值
 * @returns 可直接展示的字符串
 */
function formatMetadataValue(value?: string | number | null) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

/**
 * 格式化亮度信息。
 * @param value 亮度值，单位 nit
 * @returns 带单位的亮度文案
 */
function formatNitValue(value?: number | null) {
  if (value === undefined || value === null) {
    return "-";
  }

  return `${Number.isInteger(value) ? value : value.toFixed(3)} nit`;
}

export function PreviewInspector({ splitMode, videoMetadata, codec, encoder, twoPass, runtime }: Props) {
  const video = videoMetadata?.video;
  const shouldShowSdrNotice = isHdrSource(video?.hdrType);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>预览状态</CardTitle>
          <CardDescription>预览以当前时间点的源帧和参数帧进行近似对比。</CardDescription>
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
                ? "当前任务启用了 2-pass，预览阶段已降级为单帧参数预览。"
                : "当前任务以单帧参数预览，适合快速检查画面变化。"}
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
          <CardDescription>预览页右侧固定展示素材、HDR 信息和参数关键字段。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {shouldShowSdrNotice ? (
            <Alert>
              <AlertTitle>HDR 源已按 SDR 图片显示</AlertTitle>
              <AlertDescription>
                当前对比帧通过 FFmpeg 抽取为普通图片，预览用于检查构图和参数差异，不代表真实 HDR 亮度显示效果。
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="rounded-2xl border p-3">分辨率: {video?.width ?? "-"} x {video?.height ?? "-"}</div>
          <div className="rounded-2xl border p-3">帧率: {video?.fps?.toFixed(2) ?? "-"}</div>
          <div className="rounded-2xl border p-3">像素格式: {formatMetadataValue(video?.pixFmt)}</div>
          <div className="rounded-2xl border p-3">位深: {video?.bitDepth ? `${video.bitDepth}-bit` : "-"}</div>
          <div className="rounded-2xl border p-3">HDR 类型: {formatMetadataValue(video?.hdrType)}</div>
          <div className="rounded-2xl border p-3">色彩原色: {formatMetadataValue(video?.colorPrimaries)}</div>
          <div className="rounded-2xl border p-3">传递函数: {formatMetadataValue(video?.colorTransfer)}</div>
          <div className="rounded-2xl border p-3">色彩空间: {formatMetadataValue(video?.colorSpace)}</div>
          <div className="rounded-2xl border p-3">MaxCLL: {formatNitValue(video?.maxContentLightLevel)}</div>
          <div className="rounded-2xl border p-3">MaxFALL: {formatNitValue(video?.maxFrameAverageLightLevel)}</div>
          <div className="rounded-2xl border p-3">
            Mastering Max: {formatNitValue(video?.masteringDisplayMaxLuminance)}
          </div>
          <div className="rounded-2xl border p-3">
            Mastering Min: {formatNitValue(video?.masteringDisplayMinLuminance)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useI18n } from "../../i18n/I18nProvider";
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
  const { t } = useI18n();
  const video = videoMetadata?.video;
  const shouldShowSdrNotice = isHdrSource(video?.hdrType);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("inspector.status.title")}</CardTitle>
          <CardDescription>{t("inspector.status.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{splitMode === "vertical" ? t("inspector.vertical") : t("inspector.horizontal")}</Badge>
            <Badge variant="outline">{codec.toUpperCase()}</Badge>
            <Badge variant="outline">{encoder}</Badge>
          </div>
          <Alert>
            <AlertTitle>{t("inspector.twoPass.title")}</AlertTitle>
            <AlertDescription>
              {runtime.degradedFromTwoPass || twoPass
                ? t("inspector.twoPass.degraded")
                : t("inspector.twoPass.single")}
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
            <div className="rounded-2xl border p-3">{runtime.isFullscreen ? t("inspector.fullscreen") : t("inspector.normal")}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("inspector.source.title")}</CardTitle>
          <CardDescription>{t("inspector.source.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {shouldShowSdrNotice ? (
            <Alert>
              <AlertTitle>{t("inspector.hdr.title")}</AlertTitle>
              <AlertDescription>
                {t("inspector.hdr.description")}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="rounded-2xl border p-3">{t("inspector.resolution")}: {video?.width ?? "-"} x {video?.height ?? "-"}</div>
          <div className="rounded-2xl border p-3">{t("inspector.fps")}: {video?.fps?.toFixed(2) ?? "-"}</div>
          <div className="rounded-2xl border p-3">{t("inspector.pixelFormat")}: {formatMetadataValue(video?.pixFmt)}</div>
          <div className="rounded-2xl border p-3">{t("inspector.bitDepth")}: {video?.bitDepth ? `${video.bitDepth}-bit` : "-"}</div>
          <div className="rounded-2xl border p-3">{t("inspector.hdrType")}: {formatMetadataValue(video?.hdrType)}</div>
          <div className="rounded-2xl border p-3">{t("inspector.primaries")}: {formatMetadataValue(video?.colorPrimaries)}</div>
          <div className="rounded-2xl border p-3">{t("inspector.transfer")}: {formatMetadataValue(video?.colorTransfer)}</div>
          <div className="rounded-2xl border p-3">{t("inspector.colorspace")}: {formatMetadataValue(video?.colorSpace)}</div>
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

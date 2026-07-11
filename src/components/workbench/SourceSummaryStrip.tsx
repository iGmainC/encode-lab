import { AlertCircle, CheckCircle2, FileVideo2, RefreshCw, Replace } from "lucide-react";
import { formatBytes, formatDuration, formatFps, formatHdrType, getPathName } from "../../lib/mediaFormat";
import type { VideoMetadataResult } from "../../types/workbench";
import { useI18n } from "../../i18n/I18nProvider";
import { Button } from "../ui/button";

type SourceSummaryStripProps = {
  sourceFilePath: string;
  metadata: VideoMetadataResult | null;
  loading: boolean;
  error: string | null;
  activeTemplateName: string;
  onPickSource: () => void;
  onRetry: () => void;
};

/**
 * 展示当前素材、读取状态和参数来源，保持为一条紧凑的会话上下文。
 */
export function SourceSummaryStrip({
  sourceFilePath,
  metadata,
  loading,
  error,
  activeTemplateName,
  onPickSource,
  onRetry,
}: SourceSummaryStripProps) {
  const { t } = useI18n();
  const video = metadata?.video;
  const audio = metadata?.audio;

  return (
    <section className="overflow-hidden rounded-lg border bg-card/70" aria-labelledby="source-summary-title">
      <div className="flex min-w-0 flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="source-summary-title" className="truncate text-sm font-semibold">
              {getPathName(sourceFilePath)}
            </h2>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              {loading ? <RefreshCw className="size-3 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-3" aria-hidden="true" />}
              {loading ? t("source.summary.analyzing") : t("source.summary.analyzed")}
            </span>
            <span className="text-xs text-muted-foreground">{t("source.summary.preset", { name: activeTemplateName })}</span>
          </div>
          <dl className="mt-2 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-5">
            <SummaryValue label={t("source.summary.container")} value={metadata?.containerFormat ?? "-"} />
            <SummaryValue
              label={t("source.summary.video")}
              value={video?.width && video?.height ? `${video.width} × ${video.height} · ${formatFps(video.fps)} fps` : "-"}
            />
            <SummaryValue
              label={t("source.summary.codec")}
              value={[video?.codecName, video?.pixFmt, video?.bitDepth ? `${video.bitDepth}-bit` : ""].filter(Boolean).join(" · ") || "-"}
            />
            <SummaryValue
              label={t("source.summary.audio")}
              value={[audio?.codecName, audio?.sampleRate ? `${audio.sampleRate / 1000} kHz` : "", audio?.channelLayout].filter(Boolean).join(" · ") || "-"}
            />
            <SummaryValue
              label={t("source.summary.hdrDurationSize")}
              value={`${formatHdrType(video?.hdrType, t("source.summary.unknownHdr"))} · ${formatDuration(metadata?.durationSec)} · ${formatBytes(metadata?.sizeBytes)}`}
            />
          </dl>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {t("source.retry")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onPickSource}>
            <Replace data-icon="inline-start" aria-hidden="true" />
            {t("source.summary.replace")}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  );
}

/** 单个素材摘要字段。 */
function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-foreground" title={value}>{value}</dd>
    </div>
  );
}

/** 空素材状态使用的图标导出，避免页面自行重复选择视觉符号。 */
export const EmptySourceIcon = FileVideo2;

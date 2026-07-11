import { CircleAlert, CircleCheck } from "lucide-react";
import { buildOutputFileNamePreview, formatFps, getParentDirectory } from "../../lib/mediaFormat";
import type { TaskDraftSnapshot, VideoMetadataResult } from "../../types/workbench";
import { useI18n } from "../../i18n/I18nProvider";

type OutputValidationBarProps = {
  sourceFilePath: string;
  metadata: VideoMetadataResult | null;
  snapshot: TaskDraftSnapshot;
  /** 当前统一校验策略返回的问题数量。 */
  issueCount: number;
};

/**
 * 展示当前参数可以确定的输出事实，并明确区分无法直接预测的体积与耗时。
 */
export function OutputValidationBar({ sourceFilePath, metadata, snapshot, issueCount }: OutputValidationBarProps) {
  const { t } = useI18n();
  const resolution = snapshot.video.resolution
    ? `${snapshot.video.resolution.width} × ${snapshot.video.resolution.height}`
    : metadata?.video?.width && metadata.video.height
      ? `${metadata.video.width} × ${metadata.video.height}`
      : t("output.validation.followSource");
  const frameRate = snapshot.video.fps ? formatFps(snapshot.video.fps) : formatFps(metadata?.video?.fps);
  const outputDir = snapshot.output.dir || getParentDirectory(sourceFilePath) || t("output.validation.sourceDirectory");
  const outputFilePreview = buildOutputFileNamePreview(
    sourceFilePath,
    snapshot,
    t("output.validation.fileNameSuffixPlaceholder"),
  );

  return (
    <section className="rounded-lg border bg-card/70" aria-labelledby="output-validation-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {issueCount === 0 ? (
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          )}
          <h2 id="output-validation-title" className="text-sm font-semibold">{t("output.validation.title")}</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {issueCount === 0
            ? t("output.validation.valid")
            : t("output.validation.issueCount", { count: issueCount })}
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-3 px-4 py-3 text-xs sm:grid-cols-3 xl:grid-cols-6">
        <ValidationValue label={t("output.validation.container")} value={snapshot.container.format.toUpperCase()} />
        <ValidationValue label={t("output.validation.video")} value={`${snapshot.video.codecFormat.toUpperCase()} · ${snapshot.video.encoder}`} />
        <ValidationValue label={t("output.validation.audio")} value={snapshot.audio.mode === "copy" ? "Copy" : "Custom"} />
        <ValidationValue label={t("output.validation.resolution")} value={resolution} />
        <ValidationValue label={t("output.validation.frameRate")} value={`${frameRate} fps`} />
        <ValidationValue label={t("output.validation.sizeAndTime")} value={t("output.validation.unknownEstimate")} muted />
      </dl>
      <div className="grid gap-1 border-t px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 truncate text-muted-foreground" title={outputDir}>
          {t("output.validation.outputDirectory", { path: outputDir })}
        </div>
        <div className="min-w-0 text-right">
          <div className="break-all font-mono text-foreground" title={outputFilePreview.displayName}>
            {t("output.validation.fileNamePreview", { name: outputFilePreview.displayName })}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("output.validation.fileNameHint")}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 输出校验中的确定性字段。 */
function ValidationValue({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-1 truncate font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

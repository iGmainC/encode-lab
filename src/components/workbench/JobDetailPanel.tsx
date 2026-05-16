import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { FilePathActions, formatPathName } from "../common/FilePathActions";
import { useI18n } from "../../i18n/I18nProvider";
import type { JobHistory, JobMetricsEvent } from "../../types/workbench";

export function JobDetailPanel({
  job,
  metrics,
  onCancelJob,
  onDeleteJob,
  canceling,
  deleting,
}: {
  job: JobHistory | null;
  metrics?: JobMetricsEvent;
  onCancelJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  canceling: boolean;
  deleting: boolean;
}) {
  const { t } = useI18n();
  const canCancel = job?.status === "queued" || job?.status === "running";
  const canDelete = Boolean(job && !canCancel);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  /**
   * 将任务详情字段复制到系统剪贴板。
   * @param key 复制按钮标识
   * @param value 需要复制的文本
   */
  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1200);
  }

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader>
        <CardTitle>{t("jobDetail.title")}</CardTitle>
        <CardDescription>{t("jobDetail.description")}</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-4 overflow-auto text-sm">
        {job ? (
          <>
            <div className="rounded-2xl border p-4">
              <div className="font-medium">{job.name ?? formatPathName(job.outputFile)}</div>
              <div className="mt-1 text-muted-foreground">{t("jobDetail.status", { value: job.status })}</div>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label={t("jobDetail.progress")} value={formatProgress(metrics?.progress)} />
                <DetailField
                  label={t("jobDetail.step")}
                  value={metrics && metrics.stepCount > 1 ? `${metrics.stepIndex}/${metrics.stepCount}` : "-"}
                />
                <DetailField label="FPS" value={formatNumber(metrics?.fps)} />
                <DetailField label="Speed" value={formatSpeed(metrics?.speed)} />
                <DetailField label="ETA" value={formatEta(metrics?.etaSec)} />
                <DetailField label={t("jobDetail.processed")} value={formatTimeMs(metrics?.timeMs)} />
                <SizeDeltaField
                  label={t("jobDetail.sizeChange")}
                  percent={job.sizeChangePercent}
                  inputSize={job.inputSizeBytes}
                  outputSize={job.outputSizeBytes}
                />
                <SizeDeltaField
                  label={t("jobDetail.videoSizeChange")}
                  percent={job.videoSizeChangePercent}
                  inputSize={job.inputVideoSizeBytes}
                  outputSize={job.outputVideoSizeBytes}
                />
              </div>
              <PathDetailField label={t("jobDetail.input")} path={job.inputFile} />
              <PathDetailField label={t("jobDetail.output")} path={job.outputFile} />
              <DetailField label={t("jobDetail.created")} value={job.createdAt} />
              <DetailField label={t("jobDetail.ended")} value={job.endedAt ?? "-"} />
            </div>
            <CopyableDiagnosticField
              label={t("jobDetail.command")}
              value={job.commandLine ?? t("jobDetail.noCommand")}
              copied={copiedKey === "command"}
              onCopy={() => void copyText("command", job.commandLine ?? "")}
              multiline
            />
            {job.error ? (
              <CopyableDiagnosticField
                label={t("jobDetail.error")}
                value={job.error}
                copied={copiedKey === "error"}
                onCopy={() => void copyText("error", job.error ?? "")}
                multiline
                tone="destructive"
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled>{t("jobDetail.pause")}</Button>
              <Button variant="outline" disabled>{t("jobDetail.resume")}</Button>
              <Button
                variant="outline"
                disabled={!canCancel || canceling}
                onClick={() => onCancelJob(job.id)}
              >
                {canceling ? t("jobDetail.canceling") : t("jobDetail.cancel")}
              </Button>
              <Button
                variant="outline"
                disabled={!canDelete || deleting}
                onClick={() => onDeleteJob(job.id)}
              >
                {deleting ? t("jobDetail.deleting") : t("jobDetail.deleteRecord")}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-6 text-muted-foreground">{t("jobDetail.empty")}</div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 任务详情中的输入/输出路径字段。
 * @param label 字段名称
 * @param path 本机文件路径
 */
function PathDetailField({ label, path }: { label: string; path: string }) {
  return (
    <div className="min-w-0 rounded-2xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2">
        <FilePathActions path={path} />
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border p-3 text-muted-foreground">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

/**
 * 展示成功转码后的体积变化率。
 * @param label 指标名称
 * @param percent 输出相对输入的百分比变化
 * @param inputSize 输入大小，单位字节
 * @param outputSize 输出大小，单位字节
 */
function SizeDeltaField({
  label,
  percent,
  inputSize,
  outputSize,
}: {
  label: string;
  percent?: number | null;
  inputSize?: number | null;
  outputSize?: number | null;
}) {
  const deltaText = formatSizeChangePercent(percent);
  const detailText = formatSizePair(inputSize, outputSize);
  // 正数代表输出文件更大，按风险提示使用红色；负数代表体积减小，使用绿色。
  const toneClass =
    typeof percent !== "number"
      ? "text-muted-foreground"
      : percent > 0
        ? "text-destructive"
        : percent < 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground";

  return (
    <div className="min-w-0 rounded-2xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-medium ${toneClass}`}>{deltaText}</div>
      {detailText ? (
        <div className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {detailText}
        </div>
      ) : null}
    </div>
  );
}

function CopyableDiagnosticField({
  label,
  value,
  copied,
  onCopy,
  multiline = false,
  tone = "default",
}: {
  label: string;
  value: string;
  copied?: boolean;
  onCopy?: () => void;
  multiline?: boolean;
  tone?: "default" | "destructive";
}) {
  const toneClass =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "text-muted-foreground";
  const valueClass = multiline
    ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
    : "break-words [overflow-wrap:anywhere]";

  return (
    <div className={`min-w-0 rounded-2xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={tone === "destructive" ? "text-xs" : "text-xs text-muted-foreground"}>{label}</div>
        {onCopy ? <CopyButton copied={Boolean(copied)} onCopy={onCopy} /> : null}
      </div>
      <div className={`mt-1 ${valueClass}`}>{value}</div>
    </div>
  );
}

function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  const { t } = useI18n();
  const Icon = copied ? Check : Copy;
  const label = copied ? t("common.copied") : t("common.copy");

  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition hover:bg-muted"
      onClick={(event) => {
        event.stopPropagation();
        onCopy();
      }}
      title={label}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function formatProgress(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "-";
}

function formatNumber(value?: number | null) {
  return typeof value === "number" ? value.toFixed(1) : "-";
}

function formatSpeed(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(2)}x` : "-";
}

function formatEta(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatTimeMs(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 格式化体积变化率。
 * @param value 输出相对输入的百分比变化
 */
function formatSizeChangePercent(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * 格式化输入/输出文件大小对照。
 * @param inputSize 输入文件大小，单位字节
 * @param outputSize 输出文件大小，单位字节
 */
function formatSizePair(inputSize?: number | null, outputSize?: number | null) {
  if (typeof inputSize !== "number" || typeof outputSize !== "number") {
    return "";
  }
  return `${formatBytes(inputSize)} -> ${formatBytes(outputSize)}`;
}

/**
 * 按常见文件单位格式化字节数。
 * @param value 字节数
 */
function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    // 按二进制进位展示文件体积，和操作系统常见显示更接近。
    nextValue /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
}

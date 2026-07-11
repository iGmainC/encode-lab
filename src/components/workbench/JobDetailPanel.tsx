import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileOutput,
  Square,
  Trash2,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FilePathActions, formatPathName } from "../common/FilePathActions";
import { useI18n } from "../../i18n/I18nProvider";
import { formatJobStepLabel } from "../../lib/jobMetrics";
import type { JobHistory, JobMetricsEvent } from "../../types/workbench";

/** 国际化文案查询函数。 */
type Translate = ReturnType<typeof useI18n>["t"];

/**
 * 按任务状态组织实时指标、诊断信息、输出结果和记录操作。
 */
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

  useEffect(() => {
    // 切换任务后清除上一条记录的复制成功态，避免误导当前详情。
    setCopiedKey(null);
  }, [job?.id]);

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
    <aside className="flex min-h-0 flex-col border-t bg-muted/[0.12] xl:border-l xl:border-t-0" aria-label={t("jobDetail.ariaLabel")}>
      {job ? (
        <>
          <header className="border-b bg-background/70 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <JobStatusBadge status={job.status} />
              <span className="font-mono text-[10px] text-muted-foreground">#{job.id.slice(-12)}</span>
            </div>
            <h2 className="mt-3 truncate text-lg font-semibold" title={job.name ?? formatPathName(job.outputFile)}>
              {job.name ?? formatPathName(job.outputFile)}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{getStatusSummary(job, metrics, t)}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {canCancel ? (
                <Button
                  variant="destructive"
                  disabled={canceling}
                  onClick={() => onCancelJob(job.id)}
                >
                  <Square data-icon="inline-start" aria-hidden="true" />
                  {canceling ? t("jobDetail.canceling") : t("jobDetail.cancelTask")}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleting}
                  onClick={() => onDeleteJob(job.id)}
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  {deleting ? t("jobDetail.deleting") : t("jobDetail.deleteRecord")}
                </Button>
              ) : null}
            </div>
            {canDelete ? (
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t("jobDetail.deleteHint")}</p>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-auto text-sm">
            <NextAction job={job} />

            {canCancel ? <LiveExecution job={job} metrics={metrics} /> : null}

            {job.status === "failed" || job.status === "interrupted" ? (
              <FailureSection
                error={job.error}
                copied={copiedKey === "error"}
                onCopy={job.error ? () => void copyText("error", job.error ?? "") : undefined}
              />
            ) : null}

            {job.status === "completed" ? <OutputResultSection job={job} /> : null}

            <section className="border-b px-5 py-5">
              <div className="flex items-center gap-2">
                <FileOutput className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("jobDetail.files")}</h3>
              </div>
              <div className="mt-3 divide-y border-y">
                <PathDetailField
                  label={job.status === "completed" ? t("jobDetail.output") : t("jobDetail.targetOutput")}
                  path={job.outputFile}
                />
                <PathDetailField label={t("jobDetail.input")} path={job.inputFile} />
              </div>
            </section>

            <section className="border-b px-5 py-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("jobDetail.executionRecord")}</h3>
              <dl className="mt-3 divide-y border-y">
                <DetailRow label={t("jobDetail.statusLabel")} value={getStatusLabel(job.status, t)} />
                <DetailRow label={t("jobDetail.createdAt")} value={formatDateTime(job.createdAt)} />
                <DetailRow label={t("jobDetail.startedAt")} value={formatDateTime(job.startedAt)} />
                <DetailRow label={t("jobDetail.endedAt")} value={formatDateTime(job.endedAt)} />
                <DetailRow label={t("jobDetail.taskId")} value={job.id} monospace />
              </dl>
            </section>

            <details className="group border-b px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none marker:hidden">
                <span>{t("jobDetail.command")}</span>
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-end">
                  {job.commandLine ? (
                    <CopyButton
                      copied={copiedKey === "command"}
                      onCopy={() => void copyText("command", job.commandLine ?? "")}
                    />
                  ) : null}
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                  {job.commandLine ?? t("jobDetail.noCommand")}
                </pre>
              </div>
            </details>
          </div>
        </>
      ) : (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-8 text-center text-muted-foreground">
          <FileOutput className="size-7 opacity-40" aria-hidden="true" />
          <div className="mt-3 text-sm font-medium text-foreground">{t("jobDetail.emptyTitle")}</div>
          <p className="mt-1 text-xs leading-5">{t("jobDetail.empty")}</p>
        </div>
      )}
    </aside>
  );
}

/**
 * 给出与任务当前状态匹配的可执行下一步。
 */
function NextAction({ job }: { job: JobHistory }) {
  const { t } = useI18n();
  const action = getNextAction(job.status, t);
  return (
    <div className={`border-b px-5 py-3 ${action.tone === "danger" ? "bg-destructive/5" : "bg-primary/[0.035]"}`}>
      <div className="flex gap-3">
        {action.tone === "danger" ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <div>
          <div className={`text-xs font-semibold ${action.tone === "danger" ? "text-destructive" : "text-foreground"}`}>
            {t("jobDetail.nextAction")}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * 展示运行中任务最重要的进度、性能和阶段指标。
 */
function LiveExecution({ job, metrics }: { job: JobHistory; metrics?: JobMetricsEvent }) {
  const { t } = useI18n();
  const progress = typeof metrics?.progress === "number" ? clampProgress(metrics.progress) : null;
  const progressLabel = job.status === "queued"
    ? t("jobs.progress.waiting")
    : formatProgress(progress, t("jobDetail.collecting"));
  const progressWidth = job.status === "queued" ? 0 : progress ?? 0;

  return (
    <section className="border-b px-5 py-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("jobDetail.liveExecution")}</h3>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight">{progressLabel}</div>
        </div>
        <div className="max-w-[55%] text-right text-xs leading-5 text-muted-foreground">
          {job.status === "queued"
            ? t("jobDetail.waitingSlot")
            : formatJobStepLabel(metrics, t)}
        </div>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t("jobDetail.liveProgressAria")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${progressWidth}%` }} />
      </div>

      <dl className="mt-5 grid grid-cols-2 border-y sm:grid-cols-4">
        <MetricDatum label={t("jobDetail.processed")} value={formatTimeMs(metrics?.timeMs)} />
        <MetricDatum label="FPS" value={formatNumber(metrics?.fps)} />
        <MetricDatum label="Speed" value={formatSpeed(metrics?.speed)} />
        <MetricDatum label="ETA" value={formatEta(metrics?.etaSec)} />
      </dl>
    </section>
  );
}

/**
 * 展示失败任务的诊断摘要，并保留复制错误的排障入口。
 */
function FailureSection({
  error,
  copied,
  onCopy,
}: {
  error?: string | null;
  copied: boolean;
  onCopy?: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="border-b px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-wide">{t("jobDetail.failureTitle")}</h3>
        </div>
        {onCopy ? <CopyButton copied={copied} onCopy={onCopy} /> : null}
      </div>
      <div className="mt-3 border-l-2 border-destructive bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {error ?? t("jobDetail.failureEmpty")}
      </div>
    </section>
  );
}

/**
 * 展示已完成任务的文件与视频轨道体积结果。
 */
function OutputResultSection({ job }: { job: JobHistory }) {
  const { t } = useI18n();
  return (
    <section className="border-b px-5 py-5">
      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wide">{t("jobDetail.outputResult")}</h3>
      </div>
      <div className="mt-3 divide-y border-y">
        <SizeDeltaRow
          label={t("jobDetail.fileSize")}
          percent={job.sizeChangePercent}
          inputSize={job.inputSizeBytes}
          outputSize={job.outputSizeBytes}
        />
        <SizeDeltaRow
          label={t("jobDetail.videoTrack")}
          percent={job.videoSizeChangePercent}
          inputSize={job.inputVideoSizeBytes}
          outputSize={job.outputVideoSizeBytes}
        />
      </div>
    </section>
  );
}

/**
 * 任务详情中的输入或输出路径字段。
 * @param label 字段名称
 * @param path 本机文件路径
 */
function PathDetailField({ label, path }: { label: string; path: string }) {
  return (
    <div className="min-w-0 py-3">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      <FilePathActions path={path} />
    </div>
  );
}

/**
 * 展示执行记录中的单行键值信息。
 */
function DetailRow({ label, value, monospace = false }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-words text-right [overflow-wrap:anywhere] ${monospace ? "font-mono" : "tabular-nums"}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 展示实时指标中的单项数据。
 */
function MetricDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b px-3 py-3 even:border-l sm:border-b-0 sm:border-l sm:first:border-l-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * 展示成功转码后的体积变化率与输入输出对照。
 */
function SizeDeltaRow({
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
  const { t } = useI18n();
  const deltaText = formatSizeChangePercent(percent);
  const detailText = formatSizePair(inputSize, outputSize);
  // 正数代表输出更大，按风险提示使用红色；负数代表体积减小，使用绿色。
  const toneClass =
    typeof percent !== "number"
      ? "text-muted-foreground"
      : percent > 0
        ? "text-destructive"
        : percent < 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground";

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{detailText || t("jobDetail.sizeMissing")}</div>
      </div>
      <div className={`font-mono text-base font-semibold tabular-nums ${toneClass}`}>{deltaText}</div>
    </div>
  );
}

/**
 * 展示任务状态徽标。
 */
function JobStatusBadge({ status }: { status: JobHistory["status"] }) {
  const { t } = useI18n();
  const className =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "failed" || status === "interrupted"
        ? "bg-destructive/10 text-destructive"
        : status === "running"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground";
  return <Badge className={className}>{getStatusLabel(status, t)}</Badge>;
}

/**
 * 复制诊断信息并反馈复制状态。
 */
function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  const { t } = useI18n();
  const Icon = copied ? Check : Copy;
  const label = copied ? t("common.copied") : t("common.copy");

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      onClick={(event) => {
        event.stopPropagation();
        onCopy();
      }}
      title={label}
      aria-label={label}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}

/**
 * 将任务状态映射为用户可读名称。
 */
function getStatusLabel(status: JobHistory["status"], t: Translate) {
  const labelKeys = {
    queued: "jobs.status.queued",
    running: "jobs.status.running",
    paused: "jobs.status.paused",
    completed: "jobs.status.completed",
    failed: "jobs.status.failed",
    canceled: "jobs.status.canceled",
    interrupted: "jobs.status.interrupted",
  } as const;
  return t(labelKeys[status]);
}

/**
 * 用一句话说明当前执行结果或运行阶段。
 */
function getStatusSummary(job: JobHistory, metrics: JobMetricsEvent | undefined, t: Translate) {
  if (job.status === "running") {
    return metrics ? formatJobStepLabel(metrics, t) : t("jobDetail.summary.running");
  }
  const summaryKeys = {
    queued: "jobDetail.summary.queued",
    paused: "jobDetail.summary.paused",
    completed: "jobDetail.summary.completed",
    failed: "jobDetail.summary.failed",
    canceled: "jobDetail.summary.canceled",
    interrupted: "jobDetail.summary.interrupted",
  } as const;
  return t(summaryKeys[job.status]);
}

/**
 * 根据任务状态给出明确的下一步操作。
 */
function getNextAction(status: JobHistory["status"], t: Translate): { description: string; tone: "default" | "danger" } {
  const descriptionKeys = {
    queued: "jobDetail.next.queued",
    running: "jobDetail.next.running",
    paused: "jobDetail.next.paused",
    completed: "jobDetail.next.completed",
    failed: "jobDetail.next.failed",
    canceled: "jobDetail.next.canceled",
    interrupted: "jobDetail.next.interrupted",
  } as const;
  const dangerStatuses: ReadonlySet<JobHistory["status"]> = new Set(["paused", "failed", "interrupted"]);
  return {
    description: t(descriptionKeys[status]),
    tone: dangerStatuses.has(status) ? "danger" : "default",
  };
}

/**
 * 将进度限制在后端契约允许的 0 到 100 范围。
 */
function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}

/**
 * 格式化进度百分比。
 */
function formatProgress(value: number | null | undefined, fallback: string) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : fallback;
}

/**
 * 格式化实时数值。
 */
function formatNumber(value?: number | null) {
  return typeof value === "number" ? value.toFixed(1) : "-";
}

/**
 * 格式化实时转码速度。
 */
function formatSpeed(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(2)}x` : "-";
}

/**
 * 格式化剩余时间。
 */
function formatEta(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * 格式化已处理媒体时间。
 */
function formatTimeMs(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 格式化任务时间戳。
 */
function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 格式化体积变化率。
 */
function formatSizeChangePercent(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * 格式化输入与输出文件大小对照。
 */
function formatSizePair(inputSize?: number | null, outputSize?: number | null) {
  if (typeof inputSize !== "number" || typeof outputSize !== "number") {
    return "";
  }
  return `${formatBytes(inputSize)} → ${formatBytes(outputSize)}`;
}

/**
 * 按常见文件单位格式化字节数。
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

  return `${nextValue.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

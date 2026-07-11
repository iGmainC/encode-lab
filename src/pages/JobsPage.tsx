import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, ListFilter, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { formatPathName } from "../components/common/FilePathActions";
import { JobDetailPanel } from "../components/workbench/JobDetailPanel";
import { useI18n } from "../i18n/I18nProvider";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type {
  ControlJobResponse,
  DeleteJobResponse,
  JobHistory,
  JobMetricsEvent,
} from "../types/workbench";

/** 转码中心页面所需的任务数据与刷新入口。 */
type Props = {
  jobs: JobHistory[];
  jobMetrics: Record<string, JobMetricsEvent>;
  onJobsChanged: () => void;
};

/** 转码中心支持的任务状态筛选。 */
type JobStatusFilter = "all" | "active" | "failed" | "completed";

/** 固定筛选项，保持专业工作台中的任务视图顺序稳定。 */
const STATUS_FILTER_OPTIONS: Array<{ value: JobStatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "执行中" },
  { value: "failed", label: "异常" },
  { value: "completed", label: "已完成" },
];

/**
 * 专业任务列表与详情检查器组成的转码中心。
 */
export function JobsPage({ jobs, jobMetrics, onJobsChanged }: Props) {
  const { t } = useI18n();
  const sortedJobs = useMemo(() => sortJobsByCreatedAtDesc(jobs), [jobs]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(sortedJobs[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>("all");
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const filteredJobs = useMemo(
    () => sortedJobs.filter((job) => matchesStatusFilter(job, statusFilter)),
    [sortedJobs, statusFilter],
  );
  const selectedJob = filteredJobs.find((job) => job.id === selectedJobId) ?? null;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const failedCount = jobs.filter((job) => job.status === "failed" || job.status === "interrupted").length;
  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const activeCount = runningCount + queuedCount;

  useEffect(() => {
    // 筛选或任务状态变化后，只保留当前列表中真实可见的选中项。
    const fallbackJobId = filteredJobs[0]?.id ?? null;
    if (filteredJobs.some((job) => job.id === selectedJobId) || selectedJobId === fallbackJobId) {
      return;
    }
    setSelectedJobId(fallbackJobId);
  }, [filteredJobs, selectedJobId]);

  /**
   * 取消排队或运行中的转码任务，并将后端失败反馈给用户。
   * @param jobId 需要取消的任务 id
   */
  async function cancelJob(jobId: string) {
    setActionError(null);
    setCancelingJobId(jobId);
    try {
      if (!isTauriRuntime()) {
        return;
      }

      const response = await invoke<ControlJobResponse>("control_job", {
        request: { jobId, action: "cancel" },
      });
      if (!response.ok) {
        throw new Error("任务状态已经变化，取消操作未生效");
      }
      onJobsChanged();
    } catch (error) {
      // Tauri 命令可能抛出结构化对象或 Error，统一提取成可读反馈。
      setActionError(`取消任务失败：${formatActionError(error)}`);
    } finally {
      setCancelingJobId(null);
    }
  }

  /**
   * 删除已结束任务的历史记录，不删除转码输出文件。
   * @param jobId 需要删除的任务 id
   */
  async function deleteJob(jobId: string) {
    const job = sortedJobs.find((item) => item.id === jobId);
    const jobName = job?.name?.trim() || formatPathName(job?.outputFile ?? "") || jobId;
    const confirmed = window.confirm(
      `只删除“${jobName}”的任务记录。\n\n输出文件不会被删除，仍会保留在磁盘上。\n\n确定继续吗？`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setDeletingJobId(jobId);
    try {
      if (!isTauriRuntime()) {
        return;
      }

      const response = await invoke<DeleteJobResponse>("delete_job", {
        request: { jobId },
      });
      if (!response.ok) {
        throw new Error("记录仍然存在，删除操作未生效");
      }
      onJobsChanged();
    } catch (error) {
      // 删除失败时保留当前详情，避免用户失去错误上下文。
      setActionError(`删除记录失败：${formatActionError(error)}`);
    } finally {
      setDeletingJobId(null);
    }
  }

  return (
    <div className="flex min-h-[680px] flex-col gap-4 xl:h-[calc(100vh-12rem)]">
      <header className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            activeCount > 0 ? "text-primary" : "text-muted-foreground"
          }`}
          aria-live="polite"
        >
          <span className={`size-1.5 rounded-full ${activeCount > 0 ? "bg-primary" : "bg-muted-foreground/50"}`} />
          {activeCount > 0 ? `${activeCount} 个任务正在执行` : "本机队列空闲"}
        </span>

        <div className="flex flex-wrap items-center divide-x text-sm">
          <QueueCounter label="运行" value={runningCount} tone={runningCount > 0 ? "primary" : "default"} />
          <QueueCounter label="排队" value={queuedCount} />
          <QueueCounter label="异常" value={failedCount} tone={failedCount > 0 ? "danger" : "default"} />
          <QueueCounter label="完成" value={completedCount} tone="success" />
        </div>
      </header>

      {actionError ? (
        <Alert className="border-destructive/30 bg-destructive/5">
          <Button
            size="icon-sm"
            variant="ghost"
            className="absolute right-2 top-2 text-destructive"
            onClick={() => setActionError(null)}
            aria-label="关闭错误提示"
          >
            <X aria-hidden="true" />
          </Button>
          <AlertTriangle className="absolute left-4 top-4 size-4 text-destructive" aria-hidden="true" />
          <AlertTitle className="text-destructive">任务操作未完成</AlertTitle>
          <AlertDescription className="pr-8 text-destructive/90">{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-card xl:grid-cols-[minmax(560px,1fr)_440px]">
        <section className="flex min-h-0 min-w-0 flex-col" aria-label="转码任务列表">
          <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">任务队列</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {filteredJobs.length} / {jobs.length}
              </span>
            </div>
            <div className="flex w-fit items-center gap-1 rounded-lg bg-muted/60 p-1" aria-label="任务状态筛选">
              <ListFilter className="ml-1 size-3.5 text-muted-foreground" aria-hidden="true" />
              {STATUS_FILTER_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="xs"
                  variant={statusFilter === option.value ? "outline" : "ghost"}
                  className={statusFilter === option.value ? "bg-background shadow-xs" : "text-muted-foreground"}
                  onClick={() => {
                    setStatusFilter(option.value);
                    setActionError(null);
                  }}
                  aria-pressed={statusFilter === option.value}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="hidden grid-cols-[minmax(0,1fr)_96px_138px_116px] gap-3 border-b bg-muted/20 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <div>任务 / 进度</div>
            <div>状态</div>
            <div>实时</div>
            <div>输出</div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {filteredJobs.map((job) => {
              const metrics = jobMetrics[job.id];
              const selected = job.id === selectedJobId;
              return (
                <button
                  key={job.id}
                  type="button"
                  className={`grid w-full gap-3 border-b border-l-2 px-4 py-3 text-left outline-none transition-colors last:border-b-0 focus-visible:bg-ring/10 lg:grid-cols-[minmax(0,1fr)_96px_138px_116px] lg:items-center ${
                    selected
                      ? "border-l-primary bg-primary/[0.045]"
                      : job.status === "failed"
                        ? "border-l-transparent bg-destructive/[0.025] hover:bg-destructive/[0.05]"
                        : "border-l-transparent hover:bg-muted/35"
                  }`}
                  onClick={() => {
                    setSelectedJobId(job.id);
                    setActionError(null);
                  }}
                  aria-pressed={selected}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{job.name ?? formatPathName(job.outputFile)}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatJobId(job.id)}</span>
                    </div>
                    {job.error && (job.status === "failed" || job.status === "interrupted") ? (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-destructive">
                        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{job.error}</span>
                      </div>
                    ) : (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {t("jobs.output", { value: formatPathName(job.outputFile) })}
                      </div>
                    )}
                    <JobProgress job={job} metrics={metrics} emptyText={t("jobs.progressEmpty")} />
                  </div>
                  <JobStatusBadge status={job.status} />
                  <JobRuntimeSummary job={job} metrics={metrics} />
                  <JobOutputSummary job={job} />
                </button>
              );
            })}

            {filteredJobs.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
                <CheckCircle2 className="size-7 text-muted-foreground/50" aria-hidden="true" />
                <div className="mt-3 text-sm font-medium">
                  {jobs.length === 0 ? "还没有转码任务" : "当前筛选下没有任务"}
                </div>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  {jobs.length === 0
                    ? "从工作台验证参数并加入队列后，实时进度和输出结果会出现在这里。"
                    : "切换状态筛选，或等待任务状态更新。"}
                </p>
                {jobs.length > 0 && statusFilter !== "all" ? (
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => setStatusFilter("all")}>
                    查看全部任务
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <JobDetailPanel
          job={selectedJob}
          metrics={selectedJob ? jobMetrics[selectedJob.id] : undefined}
          onCancelJob={(jobId) => void cancelJob(jobId)}
          onDeleteJob={(jobId) => void deleteJob(jobId)}
          canceling={cancelingJobId === selectedJob?.id}
          deleting={deletingJobId === selectedJob?.id}
        />
      </div>
    </div>
  );
}

/**
 * 判断任务是否应出现在指定状态视图中。
 * @param job 任务历史记录
 * @param statusFilter 当前状态筛选
 */
function matchesStatusFilter(job: JobHistory, statusFilter: JobStatusFilter) {
  if (statusFilter === "all") {
    return true;
  }
  if (statusFilter === "active") {
    return job.status === "queued" || job.status === "running";
  }
  if (statusFilter === "failed") {
    return job.status === "failed" || job.status === "interrupted";
  }
  return job.status === "completed";
}

/**
 * 按创建时间倒序排列任务展示数据。
 * @param jobs 后端返回的任务历史记录
 */
function sortJobsByCreatedAtDesc(jobs: JobHistory[]) {
  return [...jobs].sort((a, b) => {
    // createdAt 异常时回退为 0，避免坏历史数据导致列表渲染失败。
    const aTime = Date.parse(a.createdAt) || 0;
    const bTime = Date.parse(b.createdAt) || 0;
    return bTime - aTime;
  });
}

/**
 * 展示页面顶部的紧凑队列计数，避免使用大尺寸指标卡。
 */
function QueueCounter({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "success" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-destructive",
  }[tone];

  return (
    <div className="flex items-baseline gap-1.5 px-3 first:pl-0 last:pr-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

/**
 * 展示排队或运行任务的实时进度条。
 */
function JobProgress({
  job,
  metrics,
  emptyText,
}: {
  job: JobHistory;
  metrics?: JobMetricsEvent;
  emptyText: string;
}) {
  if (job.status !== "queued" && job.status !== "running") {
    return null;
  }

  const progress = typeof metrics?.progress === "number" ? clampProgress(metrics.progress) : null;
  const label = job.status === "queued" ? "等待调度" : formatProgress(progress, emptyText);

  return (
    <div className="mt-2 flex items-center gap-2">
      <div
        className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${job.name ?? job.id} 转码进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
      >
        <div
          className={`h-full transition-[width] ${job.status === "running" ? "bg-primary" : "bg-muted-foreground/25"}`}
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>
      <span className="w-16 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * 展示列表中的实时性能与阶段信息。
 */
function JobRuntimeSummary({ job, metrics }: { job: JobHistory; metrics?: JobMetricsEvent }) {
  if (job.status === "running") {
    return (
      <div className="min-w-0 text-xs tabular-nums">
        <div className="font-mono text-foreground">{formatSpeed(metrics?.speed)} · {formatNumber(metrics?.fps)} fps</div>
        <div className="mt-1 truncate text-muted-foreground">
          ETA {formatEta(metrics?.etaSec)}{metrics?.stepCount && metrics.stepCount > 1 ? ` · ${metrics.stepIndex}/${metrics.stepCount}` : ""}
        </div>
      </div>
    );
  }

  if (job.status === "queued") {
    return (
      <div className="text-xs">
        <div className="font-medium">等待调度</div>
        <div className="mt-1 text-muted-foreground">{formatTimestamp(job.createdAt)}</div>
      </div>
    );
  }

  return (
    <div className="text-xs">
      <div className="text-muted-foreground">{job.endedAt ? "结束于" : "创建于"}</div>
      <div className="mt-1 tabular-nums">{formatTimestamp(job.endedAt ?? job.createdAt)}</div>
    </div>
  );
}

/**
 * 展示列表中的输出结果摘要。
 */
function JobOutputSummary({ job }: { job: JobHistory }) {
  if (job.status === "completed") {
    const toneClass =
      typeof job.sizeChangePercent !== "number"
        ? "text-foreground"
        : job.sizeChangePercent > 0
          ? "text-destructive"
          : job.sizeChangePercent < 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-foreground";
    return (
      <div className="text-xs">
        <div className={`font-mono font-semibold tabular-nums ${toneClass}`}>
          {formatSizeChangePercent(job.sizeChangePercent)}
        </div>
        <div className="mt-1 text-muted-foreground">{formatBytes(job.outputSizeBytes)}</div>
      </div>
    );
  }

  if (job.status === "failed" || job.status === "interrupted") {
    return (
      <div className="text-xs text-destructive">
        <div className="font-medium">不可用</div>
        <div className="mt-1 opacity-80">查看错误</div>
      </div>
    );
  }

  return (
    <div className="text-xs text-muted-foreground">
      <div>{job.status === "canceled" ? "未生成" : "目标已设置"}</div>
      <div className="mt-1 truncate">{formatPathName(job.outputFile)}</div>
    </div>
  );
}

/**
 * 将任务状态转换为一致的中文徽标。
 */
function JobStatusBadge({ status }: { status: JobHistory["status"] }) {
  const labelMap: Record<JobHistory["status"], string> = {
    queued: "排队",
    running: "运行",
    paused: "暂停",
    completed: "完成",
    failed: "失败",
    canceled: "取消",
    interrupted: "中断",
  };
  const className =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "failed" || status === "interrupted"
        ? "bg-destructive/10 text-destructive"
        : status === "running"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground";
  return <Badge className={`w-fit ${className}`}>{labelMap[status]}</Badge>;
}

/**
 * 将任务 id 收敛成列表中便于核对的短标识。
 */
function formatJobId(value: string) {
  return `#${value.slice(-8)}`;
}

/**
 * 将未知异常转换为用户可读的后端错误信息。
 */
function formatActionError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "未知错误，请刷新队列后重试";
}

/**
 * 将进度限制在后端契约允许的 0 到 100 范围。
 */
function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}

/**
 * 格式化百分比进度。
 */
function formatProgress(value: number | null | undefined, emptyText: string) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : emptyText;
}

/**
 * 格式化输出体积变化率。
 */
function formatSizeChangePercent(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * 格式化任务时间戳，保留桌面工具排障所需的日期和时间。
 */
function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
 * 按常见文件单位格式化可选字节数。
 */
function formatBytes(value?: number | null) {
  if (typeof value !== "number") {
    return "体积待记录";
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

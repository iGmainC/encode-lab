import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, FolderKanban, ListFilter, PlayCircle } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
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

type Props = {
  jobs: JobHistory[];
  jobMetrics: Record<string, JobMetricsEvent>;
  onJobsChanged: () => void;
};

export function JobsPage({ jobs, jobMetrics, onJobsChanged }: Props) {
  const { t } = useI18n();
  const sortedJobs = useMemo(() => sortJobsByCreatedAtDesc(jobs), [jobs]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(sortedJobs[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "failed" | "completed">("all");
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const filteredJobs = useMemo(
    () => sortedJobs.filter((job) => matchesStatusFilter(job, statusFilter)),
    [sortedJobs, statusFilter],
  );
  const selectedJob = sortedJobs.find((job) => job.id === selectedJobId) ?? null;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const activeCount = runningCount + queuedCount;

  useEffect(() => {
    if (!selectedJobId && sortedJobs[0]) {
      setSelectedJobId(sortedJobs[0].id);
      return;
    }

    if (selectedJobId && !sortedJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(sortedJobs[0]?.id ?? null);
    }
  }, [sortedJobs, selectedJobId]);

  /**
   * 取消排队或运行中的转码任务。
   * @param jobId 需要取消的任务 id
   */
  async function cancelJob(jobId: string) {
    setCancelingJobId(jobId);
    try {
      if (!isTauriRuntime()) {
        return;
      }

      await invoke<ControlJobResponse>("control_job", {
        request: { jobId, action: "cancel" },
      });
      onJobsChanged();
    } finally {
      setCancelingJobId(null);
    }
  }

  /**
   * 删除已结束任务的历史记录，不删除转码输出文件。
   * @param jobId 需要删除的任务 id
   */
  async function deleteJob(jobId: string) {
    setDeletingJobId(jobId);
    try {
      if (!isTauriRuntime()) {
        setSelectedJobId((current) => (current === jobId ? null : current));
        return;
      }

      await invoke<DeleteJobResponse>("delete_job", {
        request: { jobId },
      });
      setSelectedJobId((current) => (current === jobId ? null : current));
      onJobsChanged();
    } finally {
      setDeletingJobId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 xl:h-[calc(100vh-12rem)] xl:min-h-[680px]">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="shadow-sm">
          <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <FolderKanban className="size-4" aria-hidden="true" />
                执行与复盘
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">队列状态、运行控制和输出结果在这里闭环</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                运行中的任务要看进度和控制，失败任务要能定位原因，完成任务要能回到输出体积、命令和结果复盘。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:w-[280px]">
              <MetricTile label="运行中" value={String(runningCount)} tone="primary" />
              <MetricTile label="等待中" value={String(queuedCount)} />
              <MetricTile label="已完成" value={String(completedCount)} tone="success" />
              <MetricTile label="失败" value={String(failedCount)} tone={failedCount > 0 ? "danger" : "muted"} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="p-5">
            <CardTitle className="text-base">当前执行判断</CardTitle>
            <CardDescription>下一步应该关注哪里。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5 pt-0 text-sm">
            <StatusDecision
              icon={activeCount > 0 ? PlayCircle : CheckCircle2}
              title={activeCount > 0 ? "有任务正在执行" : "队列空闲"}
              description={activeCount > 0 ? "优先观察速度、ETA 和错误摘要。" : "可以从工作台发送新的已验证任务。"}
              tone={activeCount > 0 ? "primary" : "success"}
            />
            <StatusDecision
              icon={failedCount > 0 ? AlertTriangle : CheckCircle2}
              title={failedCount > 0 ? "存在失败任务" : "没有失败任务"}
              description={failedCount > 0 ? "打开详情复制错误和命令行继续排查。" : "当前没有需要立即处理的失败输出。"}
              tone={failedCount > 0 ? "danger" : "success"}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="flex flex-col shadow-sm xl:min-h-0">
          <CardHeader className="border-b p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>{t("jobs.title")}</CardTitle>
                <CardDescription>{t("jobs.description")}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "全部"],
                  ["active", "执行中"],
                  ["failed", "失败"],
                  ["completed", "完成"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={statusFilter === value ? "default" : "secondary"}
                    onClick={() => setStatusFilter(value as typeof statusFilter)}
                  >
                    {value === "all" ? <ListFilter data-icon="inline-start" aria-hidden="true" /> : null}
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="xl:min-h-0 xl:flex-1 xl:overflow-auto">
            <div className="divide-y rounded-lg border">
            {filteredJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`grid w-full gap-3 p-4 text-left transition lg:grid-cols-[minmax(0,1.3fr)_120px_120px_110px] lg:items-center ${
                  job.id === selectedJobId ? "bg-primary/5" : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="min-w-0">
                  <div className="font-medium">{job.name ?? formatPathName(job.outputFile)}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">
                    {t("jobs.output", { value: formatPathName(job.outputFile) })}
                  </div>
                  <JobProgress metrics={jobMetrics[job.id]} />
                </div>
                <JobStatusBadge status={job.status} />
                <PlanTradeoff label="体积变化" value={formatSizeChangePercent(job.sizeChangePercent)} tone={job.sizeChangePercent} />
                <PlanTradeoff label="结束时间" value={formatShortDate(job.endedAt ?? job.createdAt)} />
              </button>
            ))}
            {filteredJobs.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">当前筛选下没有任务记录。</div>
            ) : null}
            </div>
          </CardContent>
        </Card>

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

function matchesStatusFilter(job: JobHistory, statusFilter: "all" | "active" | "failed" | "completed") {
  if (statusFilter === "all") {
    return true;
  }
  if (statusFilter === "active") {
    return job.status === "queued" || job.status === "running";
  }
  return job.status === statusFilter;
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

function JobProgress({ metrics }: { metrics?: JobMetricsEvent }) {
  const { t } = useI18n();

  if (!metrics) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min(100, Math.max(0, metrics.progress ?? 0))}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{formatProgress(metrics.progress, t("jobs.progressEmpty"))}</span>
        <span>fps {formatNumber(metrics.fps)}</span>
        <span>speed {formatSpeed(metrics.speed)}</span>
        <span>ETA {formatEta(metrics.etaSec)}</span>
        {metrics.stepCount > 1 ? <span>Pass {metrics.stepIndex}/{metrics.stepCount}</span> : null}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "primary" | "success" | "danger" | "muted";
}) {
  const toneClass = {
    primary: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-destructive",
    muted: "text-foreground",
  }[tone];

  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function StatusDecision({
  icon: Icon,
  title,
  description,
  tone,
}: {
  icon: typeof CheckCircle2;
  title: string;
  description: string;
  tone: "primary" | "success" | "danger";
}) {
  const toneClass = {
    primary: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-destructive",
  }[tone];

  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <Icon className={`mt-0.5 size-4 ${toneClass}`} aria-hidden="true" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

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
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : status === "running"
          ? "bg-primary text-primary-foreground"
          : "";
  return <Badge className={className}>{labelMap[status]}</Badge>;
}

function PlanTradeoff({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number | null;
}) {
  const toneClass =
    typeof tone !== "number"
      ? "text-foreground"
      : tone > 0
        ? "text-destructive"
        : tone < 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

function formatProgress(value: number | null | undefined, emptyText: string) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : emptyText;
}

function formatSizeChangePercent(value?: number | null) {
  if (typeof value !== "number") {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
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

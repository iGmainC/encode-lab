import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { formatPathName } from "../components/common/FilePathActions";
import { JobDetailPanel } from "../components/workbench/JobDetailPanel";
import { useI18n } from "../i18n/I18nProvider";
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
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const selectedJob = sortedJobs.find((job) => job.id === selectedJobId) ?? null;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;

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
    <div className="flex flex-col gap-6 xl:h-[calc(100vh-12rem)] xl:min-h-[620px]">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">{t("jobs.running")}</div>
            <div className="mt-2 text-3xl font-semibold">{runningCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">{t("jobs.queued")}</div>
            <div className="mt-2 text-3xl font-semibold">{queuedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">{t("jobs.failed")}</div>
            <div className="mt-2 text-3xl font-semibold">{failedCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex flex-col xl:min-h-0">
          <CardHeader>
            <CardTitle>{t("jobs.title")}</CardTitle>
            <CardDescription>{t("jobs.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 xl:min-h-0 xl:flex-1 xl:overflow-auto">
            {sortedJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  job.id === selectedJobId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{job.name ?? formatPathName(job.outputFile)}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("jobs.output", { value: formatPathName(job.outputFile) })}
                    </div>
                    <JobProgress metrics={jobMetrics[job.id]} />
                  </div>
                  <Badge variant={job.status === "running" ? "default" : "secondary"}>
                    {job.status}
                  </Badge>
                </div>
              </button>
            ))}
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

function formatProgress(value: number | null | undefined, emptyText: string) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : emptyText;
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

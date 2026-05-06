import { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { JobDetailPanel } from "../components/workbench/JobDetailPanel";
import type { JobHistory } from "../types/workbench";

type Props = {
  jobs: JobHistory[];
};

export function JobsPage({ jobs }: Props) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(jobs[0]?.id ?? null);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;

  useEffect(() => {
    if (!selectedJobId && jobs[0]) {
      setSelectedJobId(jobs[0].id);
      return;
    }

    if (selectedJobId && !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0]?.id ?? null);
    }
  }, [jobs, selectedJobId]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">运行中</div>
            <div className="mt-2 text-3xl font-semibold">{runningCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">排队中</div>
            <div className="mt-2 text-3xl font-semibold">{queuedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">失败</div>
            <div className="mt-2 text-3xl font-semibold">{failedCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>任务中心</CardTitle>
            <CardDescription>左侧列表用于浏览和筛选任务，右侧详情固定展示单任务状态。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  job.id === selectedJobId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{job.name ?? job.outputFile}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      输出 {job.outputFile}
                    </div>
                  </div>
                  <Badge variant={job.status === "running" ? "default" : "secondary"}>
                    {job.status}
                  </Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <JobDetailPanel job={selectedJob} />
      </div>
    </div>
  );
}

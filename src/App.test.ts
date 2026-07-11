import { describe, expect, test } from "bun:test";
import type { JobHistory, JobStatus } from "./types/workbench";
import { reconcileJobSnapshot } from "./App";

/** 构造任务历史记录，聚焦全量快照和实时事件的先后关系。 */
function buildJob(id: string, status: JobStatus): JobHistory {
  return {
    id,
    taskId: `task-${id}`,
    name: `job-${id}`,
    inputFile: `/tmp/${id}.mov`,
    outputFile: `/tmp/${id}.mkv`,
    status,
    createdAt: "2026-07-12T00:00:00.000Z",
  };
}

describe("job snapshot reconciliation", () => {
  test("preserves an event received after list_jobs starts but before its stale snapshot returns", () => {
    const staleSnapshot = [buildJob("job-1", "running")];
    const completed = buildJob("job-1", "completed");

    const result = reconcileJobSnapshot(
      staleSnapshot,
      [{ version: 8, job: completed }],
      7,
    );

    expect(result).toEqual([completed]);
  });

  test("does not replay an event already covered when the refresh started", () => {
    const completedSnapshot = [buildJob("job-1", "completed")];
    const staleEvent = buildJob("job-1", "running");

    const result = reconcileJobSnapshot(
      completedSnapshot,
      [{ version: 7, job: staleEvent }],
      7,
    );

    expect(result).toEqual(completedSnapshot);
  });
});

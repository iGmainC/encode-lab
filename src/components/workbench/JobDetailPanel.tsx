import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import type { JobHistory } from "../../types/workbench";

export function JobDetailPanel({ job }: { job: JobHistory | null }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>任务详情</CardTitle>
        <CardDescription>展示进度、指标、命令行和错误位，后续直接接真实任务事件流。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {job ? (
          <>
            <div className="rounded-2xl border p-4">
              <div className="font-medium">{job.name ?? job.outputFile}</div>
              <div className="mt-1 text-muted-foreground">状态: {job.status}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border p-3">输入: {job.inputFile}</div>
              <div className="rounded-2xl border p-3">输出: {job.outputFile}</div>
              <div className="rounded-2xl border p-3">创建: {job.createdAt}</div>
              <div className="rounded-2xl border p-3">结束: {job.endedAt ?? "-"}</div>
            </div>
            <div className="rounded-2xl border p-4 text-muted-foreground break-all">
              {job.commandLine ?? "暂无命令行"}
            </div>
            {job.error ? <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-destructive whitespace-pre-wrap">{job.error}</div> : null}
            <div className="flex gap-2">
              <Button variant="secondary" disabled>暂停</Button>
              <Button variant="outline" disabled>继续</Button>
              <Button variant="outline" disabled>取消</Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-6 text-muted-foreground">从左侧列表选择一个任务查看详细信息。</div>
        )}
      </CardContent>
    </Card>
  );
}

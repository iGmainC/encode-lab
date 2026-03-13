import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import type { ProtoJob } from "../../types/workbench";

export function JobDetailPanel({ job }: { job: ProtoJob | null }) {
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
              <div className="font-medium">{job.name}</div>
              <div className="mt-1 text-muted-foreground">状态: {job.status}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border p-3">进度: {job.progress}%</div>
              <div className="rounded-2xl border p-3">fps: {job.fps}</div>
              <div className="rounded-2xl border p-3">ETA: {job.eta}</div>
              <div className="rounded-2xl border p-3">缩略图: 占位</div>
            </div>
            <div className="rounded-2xl border p-4 text-muted-foreground">
              命令行和 stderr 明细将在真实任务链路接入后显示。
            </div>
            <div className="flex gap-2">
              <Button variant="secondary">暂停</Button>
              <Button variant="outline">继续</Button>
              <Button variant="outline">取消</Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-6 text-muted-foreground">从左侧列表选择一个任务查看详细信息。</div>
        )}
      </CardContent>
    </Card>
  );
}

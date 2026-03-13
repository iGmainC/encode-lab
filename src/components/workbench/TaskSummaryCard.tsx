import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import type { VideoMetadataResult } from "../../types/workbench";

type Props = {
  videoMetadata: VideoMetadataResult | null;
  codec: string;
  encoder: string;
  mode: string;
  twoPass: boolean;
};

export function TaskSummaryCard({ videoMetadata, codec, encoder, mode, twoPass }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>当前任务摘要</CardTitle>
        <CardDescription>在进入预览和加入队列前，先确认源素材和目标参数是否匹配。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{codec.toUpperCase()}</Badge>
          <Badge variant="outline">{encoder}</Badge>
          <Badge variant="outline">{mode}</Badge>
          <Badge variant={twoPass ? "default" : "secondary"}>{twoPass ? "2-pass" : "1-pass"}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">源素材</div>
            <div className="mt-1 font-medium">
              {videoMetadata?.video?.width ?? "-"} x {videoMetadata?.video?.height ?? "-"}
            </div>
          </div>
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">源编码</div>
            <div className="mt-1 font-medium">{videoMetadata?.video?.codecName ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">帧率</div>
            <div className="mt-1 font-medium">{videoMetadata?.video?.fps?.toFixed(2) ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-3">
            <div className="text-muted-foreground">容器</div>
            <div className="mt-1 font-medium">{videoMetadata?.containerFormat ?? "-"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

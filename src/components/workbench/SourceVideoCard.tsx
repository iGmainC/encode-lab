import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import type { VideoMetadataResult } from "../../types/workbench";

type Props = {
  sourceFilePath: string;
  setSourceFilePath: (value: string) => void;
  videoMetadata: VideoMetadataResult | null;
  videoMetadataLoading: boolean;
  videoMetadataError: string | null;
  onRetry: () => void;
  onPickSourceFile: () => void;
  isDragOverWindow: boolean;
};

export function SourceVideoCard({
  sourceFilePath,
  setSourceFilePath,
  videoMetadata,
  videoMetadataLoading,
  videoMetadataError,
  onRetry,
  onPickSourceFile,
  isDragOverWindow,
}: Props) {
  return (
    <Card className={isDragOverWindow ? "border-primary bg-primary/5" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>源文件</CardTitle>
            <CardDescription>支持文件选择器和直接拖拽到窗口。</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onPickSourceFile}>
              选择文件
            </Button>
            <Button size="sm" variant="outline" onClick={onRetry} disabled={videoMetadataLoading}>
              {videoMetadataLoading ? "读取中..." : "重试读取"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">文件路径</span>
          <input
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
            value={sourceFilePath}
            onChange={(event) => setSourceFilePath(event.target.value)}
            placeholder="/Users/you/Videos/input.mp4"
          />
        </label>

        <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          拖拽视频到当前窗口即可自动填入并读取媒体参数。
        </div>

        {videoMetadataError ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>读取失败</AlertTitle>
            <AlertDescription>{videoMetadataError}</AlertDescription>
          </Alert>
        ) : null}

        {videoMetadata ? (
          <div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground">{videoMetadata.inputFile}</div>
            <div className="flex flex-wrap gap-2">
              {videoMetadata.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">选中文件后会自动进入下一步并生成原视频摘要。</p>
        )}
      </CardContent>
    </Card>
  );
}

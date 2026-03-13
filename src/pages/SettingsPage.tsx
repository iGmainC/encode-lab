import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import type { AppSettings, FfmpegProbeResult } from "../types/workbench";

type Props = {
  settings: AppSettings | null;
  ffmpegProbe: FfmpegProbeResult | null;
};

export function SettingsPage({ settings, ffmpegProbe }: Props) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>全局设置</CardTitle>
          <CardDescription>这一页只承载全局偏好项和环境状态，不混入任务级表单。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">并发 N</div>
            <div className="mt-2 text-2xl font-semibold">{settings?.concurrencyN ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">默认输出目录</div>
            <div className="mt-2 break-all text-sm">{settings?.defaultOutputDir || "未设置"}</div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">ffmpeg 策略</div>
            <div className="mt-2 text-sm">{settings?.ffmpegStrategy ?? "-"}</div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="text-sm text-muted-foreground">缩略图模式</div>
            <div className="mt-2 text-sm">{settings?.thumbnailMode ?? "-"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>环境调试</CardTitle>
          <CardDescription>集中放置运行时状态，避免散落在各页面头部。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-2xl border p-4">ffmpeg: {ffmpegProbe?.ffmpegFound ? "已找到" : "未找到"}</div>
          <div className="rounded-2xl border p-4">ffprobe: {ffmpegProbe?.ffprobeFound ? "已找到" : "未找到"}</div>
          <div className="rounded-2xl border p-4 break-all">{ffmpegProbe?.version ?? "暂无版本信息"}</div>
          <div className="rounded-2xl border border-dashed p-4 text-muted-foreground">
            未来在这里承载预览方向记忆、调试日志入口和高级运行选项。
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

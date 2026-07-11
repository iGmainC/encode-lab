import { CircleAlert, CircleCheck } from "lucide-react";
import { buildOutputFileName, formatFps, getParentDirectory } from "../../lib/mediaFormat";
import type { TaskDraftSnapshot, VideoMetadataResult } from "../../types/workbench";

type OutputValidationBarProps = {
  sourceFilePath: string;
  metadata: VideoMetadataResult | null;
  snapshot: TaskDraftSnapshot;
  issues: string[];
};

/**
 * 展示当前参数可以确定的输出事实，并明确区分无法直接预测的体积与耗时。
 */
export function OutputValidationBar({ sourceFilePath, metadata, snapshot, issues }: OutputValidationBarProps) {
  const resolution = snapshot.video.resolution
    ? `${snapshot.video.resolution.width} × ${snapshot.video.resolution.height}`
    : metadata?.video?.width && metadata.video.height
      ? `${metadata.video.width} × ${metadata.video.height}`
      : "跟随源素材";
  const frameRate = snapshot.video.fps ? formatFps(snapshot.video.fps) : formatFps(metadata?.video?.fps);
  const outputDir = snapshot.output.dir || getParentDirectory(sourceFilePath) || "源文件所在目录";
  const outputFile = buildOutputFileName(sourceFilePath, snapshot);

  return (
    <section className="rounded-lg border bg-card/70" aria-labelledby="output-validation-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {issues.length === 0 ? (
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          )}
          <h2 id="output-validation-title" className="text-sm font-semibold">输出校验</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {issues.length === 0 ? "当前参数满足已知执行约束" : `${issues.length} 项需要处理`}
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-3 px-4 py-3 text-xs sm:grid-cols-3 xl:grid-cols-6">
        <ValidationValue label="容器" value={snapshot.container.format.toUpperCase()} />
        <ValidationValue label="视频" value={`${snapshot.video.codecFormat.toUpperCase()} · ${snapshot.video.encoder}`} />
        <ValidationValue label="音频" value={snapshot.audio.mode === "copy" ? "Copy" : "Custom"} />
        <ValidationValue label="分辨率" value={resolution} />
        <ValidationValue label="帧率" value={`${frameRate} fps`} />
        <ValidationValue label="体积与耗时" value="无法由当前参数直接预测" muted />
      </dl>
      <div className="grid gap-1 border-t px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 truncate text-muted-foreground" title={outputDir}>输出目录：{outputDir}</div>
        <div className="font-mono text-foreground">{outputFile}</div>
      </div>
    </section>
  );
}

/** 输出校验中的确定性字段。 */
function ValidationValue({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-1 truncate font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

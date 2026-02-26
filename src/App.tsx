import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type AppSettings = {
  concurrencyN: number;
  ffmpegStrategy: string;
  defaultOutputDir: string;
  thumbnailMode: string;
};

type TaskConfig = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type Template = {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type CreateTaskResponse = {
  taskId: string;
};

type SaveTemplateResponse = {
  templateId: string;
};

type FfmpegProbeResult = {
  ffmpegFound: boolean;
  ffprobeFound: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  version?: string;
};

type EncoderCapability = {
  codecFormat: string;
  encoder: string;
  available: boolean;
  supportsTwoPass: boolean;
  supportsCrf: boolean;
  presets: string[];
  displayName: string;
  description: string;
  speedLevel: string;
  qualityLevel: string;
  requiresHardware: boolean;
  platformHints: string[];
  notes: string[];
};

type EncoderCapabilityResult = {
  source: "runtime_probe";
  items: EncoderCapability[];
};

type BuildFfmpegCommandResult = {
  commands: string[];
  warnings: string[];
  sanitizedAdvancedArgs?: string;
};

type TaskConfigPayload = {
  name: string;
  video: {
    codecFormat: "h264" | "h265" | "av1" | "vp9" | "copy";
    encoder:
      | "libx264"
      | "h264_videotoolbox"
      | "libx265"
      | "hevc_videotoolbox"
      | "hevc_nvenc"
      | "libaom_av1"
      | "svtav1"
      | "av1_nvenc"
      | "av1_videotoolbox"
      | "libvpx_vp9"
      | "copy";
    bitrateMode: "CRF" | "CBR" | "ABR";
    crf?: number;
    preset?: string;
    profile?: string;
    tune?: string;
    resolution?: { width: number; height: number };
    fps?: number;
    pixelFormat?: string;
    gop?: number;
    enableTwoPass: boolean;
  };
  audio: {
    mode: "copy" | "custom";
    customArgs?: string;
  };
  container: {
    format: "mp4" | "mkv" | "mov";
    faststart?: boolean;
  };
  advancedArgs?: string;
  output: {
    dir: string;
    fileNamePattern: string;
    overwrite: string;
  };
};

function buildSeedPayload(suffix: string): TaskConfigPayload {
  return {
    name: `demo-task-${suffix}`,
    video: {
      codecFormat: "h264",
      encoder: "libx264",
      bitrateMode: "CRF",
      crf: 23,
      preset: "medium",
      pixelFormat: "yuv420p",
      enableTwoPass: false,
    },
    audio: {
      mode: "copy",
    },
    container: {
      format: "mp4",
      faststart: true,
    },
    output: {
      dir: "",
      fileNamePattern: "{inputName}_{taskName}",
      overwrite: "autoRename",
    },
  };
}

function App() {
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskConfig[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ffmpegProbe, setFfmpegProbe] = useState<FfmpegProbeResult | null>(null);
  const [encoderCapabilities, setEncoderCapabilities] =
    useState<EncoderCapabilityResult | null>(null);
  const [commandPreview, setCommandPreview] =
    useState<BuildFfmpegCommandResult | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const samplePayload = buildSeedPayload("preview");
      const [
        settingsResult,
        tasksResult,
        templatesResult,
        ffmpegProbeResult,
        encoderCapabilitiesResult,
        commandPreviewResult,
      ] = await Promise.all([
        invoke<AppSettings>("get_settings"),
        invoke<TaskConfig[]>("list_tasks"),
        invoke<Template[]>("list_templates"),
        invoke<FfmpegProbeResult>("detect_ffmpeg"),
        invoke<EncoderCapabilityResult>("list_encoder_capabilities"),
        invoke<BuildFfmpegCommandResult>("build_ffmpeg_command", {
          request: {
            payload: samplePayload,
            inputFile: "/tmp/input.mp4",
            outputFile: "/tmp/output.mp4",
          },
        }),
      ]);

      setSettings(settingsResult);
      setTasks(tasksResult);
      setTemplates(templatesResult);
      setFfmpegProbe(ffmpegProbeResult);
      setEncoderCapabilities(encoderCapabilitiesResult);
      setCommandPreview(commandPreviewResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const seedDemoData = useCallback(async () => {
    setSeeding(true);
    setError(null);
    setSeedMessage(null);

    try {
      const suffix = Date.now().toString();
      const payload = buildSeedPayload(suffix);

      const createResult = await invoke<CreateTaskResponse>("create_task", {
        payload,
      });

      const templateResult = await invoke<SaveTemplateResponse>("save_template", {
        payload: {
          name: `demo-template-${suffix}`,
          tags: ["demo", "seed"],
          taskConfigSnapshot: payload,
        },
      });

      await fetchAll();
      setSeedMessage(
        `已创建 task=${createResult.taskId}，template=${templateResult.templateId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSeeding(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const summary = useMemo(
    () => ({
      taskCount: tasks.length,
      templateCount: templates.length,
      concurrencyN: settings?.concurrencyN ?? "-",
      ffmpegFound: ffmpegProbe?.ffmpegFound ? "是" : "否",
      ffprobeFound: ffmpegProbe?.ffprobeFound ? "是" : "否",
      availableEncoderCount:
        encoderCapabilities?.items.filter((item) => item.available).length ?? 0,
    }),
    [settings, tasks.length, templates.length, ffmpegProbe, encoderCapabilities],
  );

  const groupedEncoders = useMemo(() => {
    const map = new Map<string, EncoderCapability[]>();
    for (const item of encoderCapabilities?.items ?? []) {
      const list = map.get(item.codecFormat) ?? [];
      list.push(item);
      map.set(item.codecFormat, list);
    }
    return Array.from(map.entries());
  }, [encoderCapabilities]);

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>Encode Lab 联调面板</h1>
          <p>
            当前联调接口：get_settings / list_tasks / list_templates / detect_ffmpeg /
            list_encoder_capabilities / build_ffmpeg_command
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => void seedDemoData()} disabled={seeding || loading}>
            {seeding ? "写入中..." : "一键生成测试数据"}
          </button>
          <button type="button" onClick={() => void fetchAll()} disabled={loading || seeding}>
            {loading ? "加载中..." : "刷新"}
          </button>
        </div>
      </header>

      {error ? <div className="error">请求失败：{error}</div> : null}
      {seedMessage ? <div className="success">{seedMessage}</div> : null}

      <section className="cards">
        <article className="card stat">
          <h2>并发配置</h2>
          <div className="metric">{summary.concurrencyN}</div>
        </article>
        <article className="card stat">
          <h2>任务数量</h2>
          <div className="metric">{summary.taskCount}</div>
        </article>
        <article className="card stat">
          <h2>模板数量</h2>
          <div className="metric">{summary.templateCount}</div>
        </article>
        <article className="card stat">
          <h2>ffmpeg 可用</h2>
          <div className="metric">{summary.ffmpegFound}</div>
        </article>
        <article className="card stat">
          <h2>ffprobe 可用</h2>
          <div className="metric">{summary.ffprobeFound}</div>
        </article>
        <article className="card stat">
          <h2>可用编码器数</h2>
          <div className="metric">{summary.availableEncoderCount}</div>
        </article>
      </section>

      <section className="card">
        <h3>编码器说明卡片</h3>
        {groupedEncoders.length === 0 ? (
          <p className="muted">暂无编码器数据</p>
        ) : (
          groupedEncoders.map(([codec, items]) => (
            <div key={codec} className="encoder-group">
              <h4>{codec.toUpperCase()}</h4>
              <div className="encoder-grid">
                {items.map((item) => (
                  <article key={item.encoder} className="encoder-card">
                    <header>
                      <strong>{item.displayName}</strong>
                      <span className={item.available ? "chip ok" : "chip no"}>
                        {item.available ? "可用" : "不可用"}
                      </span>
                    </header>
                    <p>{item.description}</p>
                    <div className="meta-line">
                      <span>速度：{item.speedLevel}</span>
                      <span>质量：{item.qualityLevel}</span>
                      <span>CRF：{item.supportsCrf ? "支持" : "不支持"}</span>
                      <span>2-pass：{item.supportsTwoPass ? "支持" : "不支持"}</span>
                    </div>
                    <div className="meta-block">
                      <label>平台提示</label>
                      <div>{item.platformHints.join(" / ") || "-"}</div>
                    </div>
                    <div className="meta-block">
                      <label>备注</label>
                      <div>{item.notes.join("；") || "-"}</div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panels panels-five">
        <article className="card">
          <h3>get_settings</h3>
          <pre>{JSON.stringify(settings, null, 2)}</pre>
        </article>

        <article className="card">
          <h3>list_tasks</h3>
          <pre>{JSON.stringify(tasks, null, 2)}</pre>
        </article>

        <article className="card">
          <h3>list_templates</h3>
          <pre>{JSON.stringify(templates, null, 2)}</pre>
        </article>

        <article className="card">
          <h3>detect_ffmpeg</h3>
          <pre>{JSON.stringify(ffmpegProbe, null, 2)}</pre>
        </article>

        <article className="card">
          <h3>list_encoder_capabilities</h3>
          <pre>{JSON.stringify(encoderCapabilities, null, 2)}</pre>
        </article>

        <article className="card">
          <h3>build_ffmpeg_command (preview)</h3>
          <pre>{JSON.stringify(commandPreview, null, 2)}</pre>
        </article>
      </section>
    </main>
  );
}

export default App;

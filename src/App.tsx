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

type TaskConfigPayload = {
  name: string;
  video: {
    codecFormat: "h264" | "h265" | "copy";
    encoder:
      | "libx264"
      | "h264_videotoolbox"
      | "libx265"
      | "hevc_videotoolbox"
      | "hevc_nvenc"
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

// 生成一份最小可用的任务配置，用于联调阶段快速造数。
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

  // 并行拉取三个基础接口，作为前后端联调最小闭环。
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [settingsResult, tasksResult, templatesResult] = await Promise.all([
        invoke<AppSettings>("get_settings"),
        invoke<TaskConfig[]>("list_tasks"),
        invoke<Template[]>("list_templates"),
      ]);

      setSettings(settingsResult);
      setTasks(tasksResult);
      setTemplates(templatesResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // 一键写入测试数据：
  // 1) 创建任务
  // 2) 保存模板
  // 3) 刷新页面数据
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // 顶部统计卡片数据。
  const summary = useMemo(
    () => ({
      taskCount: tasks.length,
      templateCount: templates.length,
      concurrencyN: settings?.concurrencyN ?? "-",
    }),
    [settings, tasks.length, templates.length],
  );

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>Encode Lab 联调面板</h1>
          <p>当前联调接口：get_settings / list_tasks / list_templates</p>
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
      </section>

      <section className="panels">
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
      </section>
    </main>
  );
}

export default App;

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { WorkbenchLayout } from "./components/workbench/WorkbenchLayout";
import { TaskDraftProvider, useTaskDraft } from "./context/TaskDraftContext";
import { JobsPage } from "./pages/JobsPage";
import { DetachedPreviewPage } from "./pages/DetachedPreviewPage";
import { PreviewPage } from "./pages/PreviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskConfigPage } from "./pages/TaskConfigPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import type {
  AppSettings,
  CreateTaskResponse,
  EncoderCapabilityResult,
  EnqueueTranscodeJobResponse,
  FfmpegProbeResult,
  JobHistory,
  SaveTemplateResponse,
  TaskConfig,
  Template,
} from "./types/workbench";

const navItems = [
  { label: "任务配置", to: "/task-config" },
  { label: "预览", to: "/preview" },
  { label: "任务中心", to: "/jobs" },
  { label: "模板", to: "/templates" },
  { label: "设置", to: "/settings" },
];

function buildSeedPayload(suffix: string) {
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
    audio: { mode: "copy" },
    container: { format: "mp4", faststart: true },
    output: {
      dir: "",
      fileNamePattern: "{inputName}_{taskName}",
      overwrite: "autoRename",
    },
  };
}

function AppRoutes({
  settings,
  tasks,
  jobs,
  templates,
  ffmpegProbe,
  encoderCapabilities,
  loading,
  seeding,
  error,
  seedMessage,
  onRefresh,
  onSeed,
  onJobsChanged,
}: {
  settings: AppSettings | null;
  tasks: TaskConfig[];
  jobs: JobHistory[];
  templates: Template[];
  ffmpegProbe: FfmpegProbeResult | null;
  encoderCapabilities: EncoderCapabilityResult | null;
  loading: boolean;
  seeding: boolean;
  error: string | null;
  seedMessage: string | null;
  onRefresh: () => void;
  onSeed: () => void;
  onJobsChanged: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [splitMode, setSplitMode] = useState<"vertical" | "horizontal">("vertical");
  const [splitterPosition, setSplitterPosition] = useState(0.5);
  const [compareOrder, setCompareOrder] = useState<"source-first" | "preview-first">("source-first");
  const {
    formCodec,
    formEncoder,
    setFormEncoder,
    formPreset,
    setFormPreset,
    formMode,
    setFormMode,
    formTwoPass,
    setFormTwoPass,
    sourceFilePath,
    taskDraftSnapshot,
  } = useTaskDraft();

  const pageMeta = useMemo(() => {
    switch (location.pathname) {
      case "/preview":
        return {
          title: "预览工作台",
          description: "在单播放器对比视图中验证参数，尽量贴近真实转码性能。",
        };
      case "/jobs":
        return {
          title: "任务中心",
          description: "持续关注运行任务、排队任务和失败任务，并查看单任务详细信息。",
        };
      case "/templates":
        return {
          title: "模板库",
          description: "集中管理模板，并从模板直接进入预览与发起转码。",
        };
      case "/settings":
        return {
          title: "应用设置",
          description: "管理全局运行参数、默认目录和环境探测状态。",
        };
      default:
        return {
          title: "任务配置工作台",
          description: "以向导流组织源文件、参数配置、预览和发起转码。",
        };
    }
  }, [location.pathname]);

  const filteredEncoders = useMemo(
    () => (encoderCapabilities?.items ?? []).filter((item) => item.codecFormat === formCodec),
    [encoderCapabilities, formCodec],
  );

  const selectedEncoderCapability = useMemo(
    () => filteredEncoders.find((item) => item.encoder === formEncoder),
    [filteredEncoders, formEncoder],
  );

  useEffect(() => {
    if (filteredEncoders.length > 0 && !filteredEncoders.some((item) => item.encoder === formEncoder)) {
      setFormEncoder(filteredEncoders[0].encoder);
    }
  }, [filteredEncoders, formEncoder, setFormEncoder]);

  useEffect(() => {
    if (!selectedEncoderCapability?.supportsTwoPass && formTwoPass) {
      setFormTwoPass(false);
    }
    if (!selectedEncoderCapability?.supportsCrf && formMode === "CRF") {
      setFormMode("CBR");
    }
    if (
      selectedEncoderCapability?.presets?.length &&
      !selectedEncoderCapability.presets.includes(formPreset)
    ) {
      setFormPreset(selectedEncoderCapability.presets[0]);
    }
    if (!selectedEncoderCapability?.presets?.length) {
      setFormPreset("");
    }
  }, [
    selectedEncoderCapability,
    formMode,
    formTwoPass,
    formPreset,
    setFormMode,
    setFormPreset,
    setFormTwoPass,
  ]);

  /**
   * 将当前草稿保存为任务并发起后台转码。
   */
  const enqueueCurrentDraft = useCallback(async () => {
    if (!sourceFilePath) {
      return;
    }

    await invoke<EnqueueTranscodeJobResponse>("enqueue_transcode_job", {
      request: {
        payload: taskDraftSnapshot,
        inputFile: sourceFilePath,
      },
    });
    onJobsChanged();
    navigate("/jobs");
  }, [navigate, onJobsChanged, sourceFilePath, taskDraftSnapshot]);

  return (
    <WorkbenchLayout
      title={pageMeta.title}
      description={pageMeta.description}
      navItems={navItems}
      ffmpegProbe={ffmpegProbe}
      concurrencyN={settings?.concurrencyN ?? "-"}
      onRefresh={onRefresh}
      onSeed={onSeed}
      loading={loading}
      seeding={seeding}
    >
      <div className="space-y-4">
        {error ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>请求失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {seedMessage ? (
          <Alert className="border-primary/30 bg-primary/5">
            <AlertTitle>写入完成</AlertTitle>
            <AlertDescription>{seedMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Routes>
          <Route
            path="/task-config"
            element={
              <TaskConfigPage
                filteredEncoders={filteredEncoders}
                selectedEncoderCapability={selectedEncoderCapability}
                ffmpegProbe={ffmpegProbe}
                onGoPreview={() => navigate("/preview")}
              />
            }
          />
          <Route
            path="/preview"
            element={
              <PreviewPage
                splitMode={splitMode}
                setSplitMode={setSplitMode}
                splitterPosition={splitterPosition}
                setSplitterPosition={setSplitterPosition}
                compareOrder={compareOrder}
                setCompareOrder={setCompareOrder}
                onEnqueue={enqueueCurrentDraft}
              />
            }
          />
          <Route path="/jobs" element={<JobsPage jobs={jobs} />} />
          <Route
            path="/templates"
            element={
              <TemplatesPage
                templateCount={templates.length}
                taskCount={tasks.length}
                templates={templates}
              />
            }
          />
          <Route path="/settings" element={<SettingsPage settings={settings} ffmpegProbe={ffmpegProbe} />} />
          <Route path="*" element={<Navigate to="/task-config" replace />} />
        </Routes>
      </div>
    </WorkbenchLayout>
  );
}

function WorkbenchApp() {
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskConfig[]>([]);
  const [jobs, setJobs] = useState<JobHistory[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ffmpegProbe, setFfmpegProbe] = useState<FfmpegProbeResult | null>(null);
  const [encoderCapabilities, setEncoderCapabilities] = useState<EncoderCapabilityResult | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, tasksResult, jobsResult, templatesResult, ffmpegProbeResult, encoderCapabilitiesResult] =
        await Promise.all([
          invoke<AppSettings>("get_settings"),
          invoke<TaskConfig[]>("list_tasks"),
          invoke<JobHistory[]>("list_jobs"),
          invoke<Template[]>("list_templates"),
          invoke<FfmpegProbeResult>("detect_ffmpeg"),
          invoke<EncoderCapabilityResult>("list_encoder_capabilities"),
        ]);

      setSettings(settingsResult);
      setTasks(tasksResult);
      setJobs(jobsResult);
      setTemplates(templatesResult);
      setFfmpegProbe(ffmpegProbeResult);
      setEncoderCapabilities(encoderCapabilitiesResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      const createResult = await invoke<CreateTaskResponse>("create_task", { payload });
      const templateResult = await invoke<SaveTemplateResponse>("save_template", {
        payload: {
          name: `demo-template-${suffix}`,
          tags: ["demo", "seed"],
          taskConfigSnapshot: payload,
        },
      });
      await fetchAll();
      setSeedMessage(`已创建 task=${createResult.taskId}，template=${templateResult.templateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void listen<JobHistory>("job:updated", () => {
      void fetchAll();
    }).then((unlisten) => {
      dispose = unlisten;
    });

    return () => {
      if (dispose) {
        dispose();
      }
    };
  }, [fetchAll]);

  return (
    <TaskDraftProvider>
      <AppRoutes
        settings={settings}
        tasks={tasks}
        jobs={jobs}
        templates={templates}
        ffmpegProbe={ffmpegProbe}
        encoderCapabilities={encoderCapabilities}
        loading={loading}
        seeding={seeding}
        error={error}
        seedMessage={seedMessage}
        onRefresh={() => void fetchAll()}
        onSeed={() => void seedDemoData()}
        onJobsChanged={() => void fetchAll()}
      />
    </TaskDraftProvider>
  );
}

function App() {
  const isDetachedPreviewWindow = new URLSearchParams(window.location.search).has("detachedPreview");

  if (isDetachedPreviewWindow) {
    return <DetachedPreviewPage />;
  }

  return <WorkbenchApp />;
}

export default App;

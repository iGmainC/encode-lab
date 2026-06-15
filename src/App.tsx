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
import { SourceSelectPage } from "./pages/SourceSelectPage";
import { TaskConfigPage } from "./pages/TaskConfigPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { useI18n } from "./i18n/I18nProvider";
import { isTauriRuntime } from "./lib/tauriRuntime";
import type {
  AppSettings,
  CreateTaskResponse,
  EncoderCapabilityResult,
  EnqueueTranscodeJobResponse,
  FfmpegProbeResult,
  JobHistory,
  JobMetricsEvent,
  SaveTemplateResponse,
  TaskConfig,
  TaskDraftSnapshot,
  Template,
} from "./types/workbench";

/**
 * 构造最小可用的任务参数快照，供样例数据和浏览器预览态复用。
 * @param suffix 样例任务名称后缀
 * @returns 任务草稿快照
 */
function buildSeedPayload(suffix: string): TaskDraftSnapshot {
  return {
    name: `demo-task-${suffix}`,
    video: {
      codecFormat: "h265",
      encoder: "libx265",
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

/**
 * 普通浏览器预览态的数据，专用于设计 QA 和前端首屏验证。
 * @returns 不依赖 Tauri 命令的前端示例数据
 */
function buildBrowserPreviewState(): {
  settings: AppSettings;
  jobs: JobHistory[];
  templates: Template[];
  ffmpegProbe: FfmpegProbeResult;
  encoderCapabilities: EncoderCapabilityResult;
} {
  return {
    settings: {
      concurrencyN: 2,
      ffmpegStrategy: "bundled",
      defaultOutputDir: "/Users/encode-lab/Encode Lab/Outputs",
      thumbnailMode: "local",
    },
    jobs: [
      {
        id: "demo-completed-1",
        taskId: "demo-task-1",
        name: "Interview_final.mp4",
        inputFile: "/Users/encode-lab/Interview.mov",
        outputFile: "/Users/encode-lab/Encode Lab/Outputs/Interview_final.mp4",
        status: "completed",
        sizeChangePercent: -87,
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "demo-completed-2",
        taskId: "demo-task-2",
        name: "Broll_sequence.mp4",
        inputFile: "/Users/encode-lab/Broll.mov",
        outputFile: "/Users/encode-lab/Encode Lab/Outputs/Broll_sequence.mp4",
        status: "completed",
        sizeChangePercent: -82,
        createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      },
    ],
    templates: [
      {
        id: "browser-publish-plan",
        name: "线上发布副本",
        tags: ["web", "balanced"],
        version: 1,
        taskConfigSnapshot: buildSeedPayload("publish"),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      },
    ],
    ffmpegProbe: {
      ffmpegFound: true,
      ffprobeFound: true,
      ffmpegPath: "/usr/local/bin/ffmpeg",
      ffprobePath: "/usr/local/bin/ffprobe",
      version: "ffmpeg 7.x browser preview",
      dolbyVision: {
        supportsDoviRpu: true,
        supportsDolbyVisionEncode: false,
        supportsPreservePipeline: false,
        supportedEncoders: ["libx265"],
        recommendedEncoder: "libx265",
      },
    },
    encoderCapabilities: {
      source: "runtime_probe",
      items: [
        {
          codecFormat: "h264",
          encoder: "libx264",
          available: true,
          supportsTwoPass: true,
          supportsCrf: true,
          displayName: "H.264 / libx264",
          description: "Reliable compatibility for online publishing.",
          speedLevel: "balanced",
          qualityLevel: "high",
          presets: ["fast", "medium", "slow"],
        },
        {
          codecFormat: "h265",
          encoder: "libx265",
          available: true,
          supportsTwoPass: true,
          supportsCrf: true,
          displayName: "H.265 / libx265",
          description: "Smaller files with high visual quality.",
          speedLevel: "balanced",
          qualityLevel: "high",
          presets: ["fast", "medium", "slow"],
        },
      ],
    },
  };
}

function AppRoutes({
  settings,
  tasks,
  jobs,
  jobMetrics,
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
  jobMetrics: Record<string, JobMetricsEvent>;
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
  const { t } = useI18n();
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
    applyTemplateSnapshot,
  } = useTaskDraft();

  const navItems = useMemo(
    () => [
      { label: t("nav.workbench"), to: "/source" },
      { label: t("nav.presets"), to: "/templates" },
      { label: t("nav.jobs"), to: "/jobs" },
      { label: t("nav.settings"), to: "/settings" },
    ],
    [t],
  );

  const pageMeta = useMemo(() => {
    switch (location.pathname) {
      case "/source":
        return {
          title: t("app.workbench.title"),
          description: t("app.workbench.sourceDescription"),
        };
      case "/task-config":
        return {
          title: t("app.workbench.title"),
          description: t("app.workbench.configDescription"),
        };
      case "/preview":
        return {
          title: t("app.workbench.title"),
          description: t("app.workbench.previewDescription"),
        };
      case "/jobs":
        return {
          title: t("app.jobs.title"),
          description: t("app.jobs.description"),
        };
      case "/templates":
        return {
          title: t("app.presets.title"),
          description: t("app.presets.description"),
        };
      case "/settings":
        return {
          title: t("app.settings.title"),
          description: t("app.settings.description"),
        };
      default:
        return {
          title: t("app.workbench.title"),
          description: t("app.workbench.sourceDescription"),
        };
    }
  }, [location.pathname, t]);

  const hasSourceFile = sourceFilePath.trim().length > 0;

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
    if (!isTauriRuntime()) {
      return;
    }

    let disposeNavigate: (() => void) | undefined;
    void listen<string>("app:navigate", (event) => {
      // 后端只下发内部路由目标，具体跳转保持在 React Router 边界内完成。
      navigate(event.payload);
    }).then((unlisten) => {
      disposeNavigate = unlisten;
    });

    return () => {
      if (disposeNavigate) {
        disposeNavigate();
      }
    };
  }, [navigate]);

  useEffect(() => {
    if (!selectedEncoderCapability) {
      // 能力探测尚未返回时不改写草稿，避免默认 CRF/medium 被空状态覆盖。
      return;
    }

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
      // preset 不兼容当前编码器时优先回到中等档，避免默认落到 ultrafast。
      setFormPreset(
        selectedEncoderCapability.presets.includes("medium")
          ? "medium"
          : selectedEncoderCapability.presets[0],
      );
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

    if (!isTauriRuntime()) {
      // 浏览器预览态没有后端队列，直接给调用方一个可展示的明确错误。
      throw new Error("浏览器预览模式不会发送真实转码任务，请在桌面应用中执行。");
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
      compactHeader={location.pathname === "/source" || location.pathname === "/task-config" || location.pathname === "/preview"}
    >
      <div className="space-y-4">
        {error ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>{t("app.error.title")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {seedMessage ? (
          <Alert className="border-primary/30 bg-primary/5">
            <AlertTitle>{t("app.seed.title")}</AlertTitle>
            <AlertDescription>{seedMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Routes>
          <Route
            path="/source"
            element={<SourceSelectPage onContinue={() => navigate("/task-config")} />}
          />
          <Route
            path="/task-config"
            element={hasSourceFile ? (
              <TaskConfigPage
                filteredEncoders={filteredEncoders}
                selectedEncoderCapability={selectedEncoderCapability}
                ffmpegProbe={ffmpegProbe}
                onBackSource={() => navigate("/source")}
                onGoPreview={() => navigate("/preview")}
                onTemplatesChanged={onRefresh}
              />
            ) : (
              <Navigate to="/source" replace />
            )}
          />
          <Route
            path="/preview"
            element={hasSourceFile ? (
              <PreviewPage
                jobs={jobs}
                splitMode={splitMode}
                setSplitMode={setSplitMode}
                splitterPosition={splitterPosition}
                setSplitterPosition={setSplitterPosition}
                compareOrder={compareOrder}
                setCompareOrder={setCompareOrder}
                onBackConfig={() => navigate("/task-config")}
                onBackSource={() => navigate("/source")}
                onOpenTemplates={() => navigate("/templates")}
                onOpenJobs={() => navigate("/jobs")}
                onEnqueue={enqueueCurrentDraft}
              />
            ) : (
              <Navigate to="/source" replace />
            )}
          />
          <Route
            path="/jobs"
            element={<JobsPage jobs={jobs} jobMetrics={jobMetrics} onJobsChanged={onJobsChanged} />}
          />
          <Route
            path="/templates"
            element={
              <TemplatesPage
                templateCount={templates.length}
                taskCount={tasks.length}
                templates={templates}
                onTemplatesChanged={onRefresh}
                onApplyTemplate={(template) => {
                  applyTemplateSnapshot(template.taskConfigSnapshot);
                  navigate(hasSourceFile ? "/task-config" : "/source");
                }}
              />
            }
          />
          <Route path="/settings" element={<SettingsPage settings={settings} ffmpegProbe={ffmpegProbe} />} />
          <Route path="*" element={<Navigate to="/source" replace />} />
        </Routes>
      </div>
    </WorkbenchLayout>
  );
}

function WorkbenchApp() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskConfig[]>([]);
  const [jobs, setJobs] = useState<JobHistory[]>([]);
  const [jobMetrics, setJobMetrics] = useState<Record<string, JobMetricsEvent>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ffmpegProbe, setFfmpegProbe] = useState<FfmpegProbeResult | null>(null);
  const [encoderCapabilities, setEncoderCapabilities] = useState<EncoderCapabilityResult | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isTauriRuntime()) {
        const browserPreviewState = buildBrowserPreviewState();
        setSettings(browserPreviewState.settings);
        setTasks([]);
        setJobs(browserPreviewState.jobs);
        setTemplates(browserPreviewState.templates);
        setFfmpegProbe(browserPreviewState.ffmpegProbe);
        setEncoderCapabilities(browserPreviewState.encoderCapabilities);
        return;
      }

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
      if (!isTauriRuntime()) {
        setSeedMessage("浏览器预览模式使用内置样例数据，不会写入桌面任务或方案。");
        return;
      }

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
      setSeedMessage(t("app.seed.message", { taskId: createResult.taskId, templateId: templateResult.templateId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }, [fetchAll, t]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposeUpdated: (() => void) | undefined;
    let disposeMetrics: (() => void) | undefined;
    void listen<JobHistory>("job:updated", () => {
      void fetchAll();
    }).then((unlisten) => {
      disposeUpdated = unlisten;
    });

    void listen<JobMetricsEvent>("job:metrics", (event) => {
      setJobMetrics((current) => ({
        ...current,
        [event.payload.jobId]: event.payload,
      }));
    }).then((unlisten) => {
      disposeMetrics = unlisten;
    });

    return () => {
      if (disposeUpdated) {
        disposeUpdated();
      }
      if (disposeMetrics) {
        disposeMetrics();
      }
    };
  }, [fetchAll]);

  return (
    <TaskDraftProvider>
      <AppRoutes
        settings={settings}
        tasks={tasks}
        jobs={jobs}
        jobMetrics={jobMetrics}
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

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
import { useI18n } from "./i18n/I18nProvider";
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
  Template,
} from "./types/workbench";

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
      { label: t("nav.workbench"), to: "/task-config" },
      { label: t("nav.presets"), to: "/templates" },
      { label: t("nav.jobs"), to: "/jobs" },
      { label: t("nav.settings"), to: "/settings" },
    ],
    [t],
  );

  const pageMeta = useMemo(() => {
    switch (location.pathname) {
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
          description: t("app.workbench.description"),
        };
    }
  }, [location.pathname, t]);

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
            path="/task-config"
            element={
              <TaskConfigPage
                filteredEncoders={filteredEncoders}
                selectedEncoderCapability={selectedEncoderCapability}
                ffmpegProbe={ffmpegProbe}
                onGoPreview={() => navigate("/preview")}
                onTemplatesChanged={onRefresh}
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
                onBackConfig={() => navigate("/task-config")}
                onEnqueue={enqueueCurrentDraft}
              />
            }
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
                  navigate("/task-config");
                }}
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

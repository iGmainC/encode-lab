import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { WorkbenchLayout } from "./components/workbench/WorkbenchLayout";
import { TaskDraftProvider, useTaskDraft } from "./context/TaskDraftContext";
import { JobsPage } from "./pages/JobsPage";
import { DetachedPreviewPage } from "./pages/DetachedPreviewPage";
import { ProfessionalWorkbenchPage } from "./pages/ProfessionalWorkbenchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { useI18n } from "./i18n/I18nProvider";
import { isTauriRuntime } from "./lib/tauriRuntime";
import { buildWorkbenchValidationIssues } from "./lib/workbenchPolicy";
import type {
  AppSettings,
  EncoderCapabilityResult,
  EnqueueTranscodeJobResponse,
  FfmpegProbeResult,
  JobHistory,
  JobMetricsEvent,
  SaveTemplateResponse,
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
      pixelFormat: "yuv420p10le",
      enableTwoPass: false,
    },
    audio: { mode: "copy" },
    container: { format: "mp4", faststart: true },
    advancedArgs: "-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc",
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
        inputSizeBytes: 12_884_901_888,
        outputSizeBytes: 1_675_037_245,
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
        inputSizeBytes: 9_663_676_416,
        outputSizeBytes: 1_739_461_755,
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
      x265Path: undefined,
      doviToolPath: undefined,
      version: "ffmpeg 7.x browser preview",
      x265Version: undefined,
      doviToolVersion: undefined,
      dolbyVision: {
        supportsDoviRpu: true,
        supportsDolbyVisionEncode: false,
        supportsPreservePipeline: false,
        supportsExternalRpuPipeline: false,
        doviToolFound: false,
        x265CliFound: false,
        supportedProfiles: [],
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
  jobs,
  jobMetrics,
  templates,
  ffmpegProbe,
  encoderCapabilities,
  loading,
  error,
  onRefresh,
  onJobsChanged,
}: {
  settings: AppSettings | null;
  jobs: JobHistory[];
  jobMetrics: Record<string, JobMetricsEvent>;
  templates: Template[];
  ffmpegProbe: FfmpegProbeResult | null;
  encoderCapabilities: EncoderCapabilityResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onJobsChanged: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
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
    videoMetadata,
    taskDraftSnapshot,
    applyTemplateSnapshot,
    setActiveTemplateName,
  } = useTaskDraft();

  const navItems = useMemo(
    () => [
      { label: t("nav.workbench"), to: "/workbench" },
      { label: t("nav.presets"), to: "/templates" },
      { label: t("nav.jobs"), to: "/jobs" },
      { label: t("nav.settings"), to: "/settings" },
    ],
    [t],
  );

  const pageMeta = useMemo(() => {
    switch (location.pathname) {
      case "/workbench":
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

    let disposed = false;
    let disposeNavigate: (() => void) | undefined;
    void listen<string>("app:navigate", (event) => {
      // 后端只下发内部路由目标，具体跳转保持在 React Router 边界内完成。
      const target = ["/source", "/task-config", "/preview"].includes(event.payload)
        ? "/workbench"
        : event.payload;
      navigate(target);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else disposeNavigate = unlisten;
    }).catch(() => {
      // 托盘导航监听失败不阻断页面内导航；刷新应用后会重新注册。
    });

    return () => {
      disposed = true;
      disposeNavigate?.();
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

    const blockingIssue = buildWorkbenchValidationIssues({
      sourceFilePath,
      metadata: videoMetadata,
      snapshot: taskDraftSnapshot,
      selectedEncoderCapability,
      ffmpegProbe,
    }).find((issue) => issue.tone === "error");
    if (blockingIssue) {
      // CTA 的 disabled 只是交互提示；处理器必须独立复核，避免键盘或未来调用方绕过。
      throw new Error(`入队被阻止：${blockingIssue.message}`);
    }

    await invoke<EnqueueTranscodeJobResponse>("enqueue_transcode_job", {
      request: {
        payload: taskDraftSnapshot,
        inputFile: sourceFilePath,
      },
    });
    onJobsChanged();
    navigate("/jobs");
  }, [ffmpegProbe, navigate, onJobsChanged, selectedEncoderCapability, sourceFilePath, taskDraftSnapshot, videoMetadata]);

  /**
   * 把当前编码参数保存为可复用方案，同时剥离素材相关的任务级字段。
   * @param input 方案名称与标签
   */
  const saveCurrentTemplate = useCallback(async ({ name, tags }: { name: string; tags: string[] }) => {
    if (!isTauriRuntime()) {
      throw new Error("浏览器预览模式不会写入本机方案库，请在桌面应用中保存。");
    }

    const templateSnapshot: TaskDraftSnapshot = {
      ...taskDraftSnapshot,
      name,
      clipRange: undefined,
      output: {
        ...taskDraftSnapshot.output,
        // 输出目录属于当前任务，不进入跨素材复用的方案资产。
        dir: "",
        location: null,
      },
    };
    await invoke<SaveTemplateResponse>("save_template", {
      payload: {
        name,
        tags,
        taskConfigSnapshot: templateSnapshot,
      },
    });
    setActiveTemplateName(name);
    onRefresh();
  }, [onRefresh, setActiveTemplateName, taskDraftSnapshot]);

  return (
    <WorkbenchLayout
      title={pageMeta.title}
      description={pageMeta.description}
      navItems={navItems}
      ffmpegProbe={ffmpegProbe}
      concurrencyN={settings?.concurrencyN ?? "-"}
      onRefresh={onRefresh}
      loading={loading}
      compactHeader={location.pathname === "/workbench"}
    >
      <div className="space-y-4">
        {error ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>{t("app.error.title")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Routes>
          <Route
            path="/workbench"
            element={
              <ProfessionalWorkbenchPage
                filteredEncoders={filteredEncoders}
                selectedEncoderCapability={selectedEncoderCapability}
                ffmpegProbe={ffmpegProbe}
                onOpenTemplates={() => navigate("/templates")}
                onOpenJobs={() => navigate("/jobs")}
                onEnqueue={enqueueCurrentDraft}
                onSaveTemplate={saveCurrentTemplate}
              />
            }
          />
          <Route path="/source" element={<Navigate to="/workbench" replace />} />
          <Route path="/task-config" element={<Navigate to="/workbench" replace />} />
          <Route path="/preview" element={<Navigate to="/workbench" replace />} />
          <Route
            path="/jobs"
            element={<JobsPage jobs={jobs} jobMetrics={jobMetrics} onJobsChanged={onJobsChanged} />}
          />
          <Route
            path="/templates"
            element={
              <TemplatesPage
                templates={templates}
                onTemplatesChanged={onRefresh}
                onApplyTemplate={(template) => {
                  applyTemplateSnapshot(template.taskConfigSnapshot, template.name);
                  navigate("/workbench");
                }}
              />
            }
          />
          <Route path="/settings" element={<SettingsPage settings={settings} ffmpegProbe={ffmpegProbe} />} />
          <Route path="*" element={<Navigate to="/workbench" replace />} />
        </Routes>
      </div>
    </WorkbenchLayout>
  );
}

function WorkbenchApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [jobs, setJobs] = useState<JobHistory[]>([]);
  const [jobMetrics, setJobMetrics] = useState<Record<string, JobMetricsEvent>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ffmpegProbe, setFfmpegProbe] = useState<FfmpegProbeResult | null>(null);
  const [encoderCapabilities, setEncoderCapabilities] = useState<EncoderCapabilityResult | null>(null);
  const fetchRequestRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const requestId = ++fetchRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      if (!isTauriRuntime()) {
        const browserPreviewState = buildBrowserPreviewState();
        if (requestId !== fetchRequestRef.current) return;
        setSettings(browserPreviewState.settings);
        setJobs(browserPreviewState.jobs);
        setTemplates(browserPreviewState.templates);
        setFfmpegProbe(browserPreviewState.ffmpegProbe);
        setEncoderCapabilities(browserPreviewState.encoderCapabilities);
        return;
      }

      const [settingsResult, jobsResult, templatesResult, ffmpegProbeResult, encoderCapabilitiesResult] =
        await Promise.all([
          invoke<AppSettings>("get_settings"),
          invoke<JobHistory[]>("list_jobs"),
          invoke<Template[]>("list_templates"),
          invoke<FfmpegProbeResult>("detect_ffmpeg"),
          invoke<EncoderCapabilityResult>("list_encoder_capabilities"),
        ]);

      // 只允许最后一次全量读取落地，连续刷新时旧响应不能覆盖较新的队列状态。
      if (requestId !== fetchRequestRef.current) return;
      setSettings(settingsResult);
      setJobs(jobsResult);
      setTemplates(templatesResult);
      setFfmpegProbe(ffmpegProbeResult);
      setEncoderCapabilities(encoderCapabilitiesResult);
    } catch (err) {
      if (requestId === fetchRequestRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === fetchRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let disposeUpdated: (() => void) | undefined;
    let disposeMetrics: (() => void) | undefined;
    void listen<JobHistory>("job:updated", (event) => {
      // 事件已经携带最新事实，直接 upsert，避免每秒状态变化触发六路全量读取。
      setJobs((current) => {
        const index = current.findIndex((job) => job.id === event.payload.id);
        if (index < 0) return [event.payload, ...current];
        const next = [...current];
        next[index] = event.payload;
        return next;
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else disposeUpdated = unlisten;
    }).catch((listenError) => {
      if (!disposed) setError(`任务状态监听失败：${listenError instanceof Error ? listenError.message : String(listenError)}`);
    });

    void listen<JobMetricsEvent>("job:metrics", (event) => {
      setJobMetrics((current) => ({
        ...current,
        [event.payload.jobId]: event.payload,
      }));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else disposeMetrics = unlisten;
    }).catch((listenError) => {
      if (!disposed) setError(`任务指标监听失败：${listenError instanceof Error ? listenError.message : String(listenError)}`);
    });

    return () => {
      disposed = true;
      disposeUpdated?.();
      disposeMetrics?.();
    };
  }, []);

  return (
    <TaskDraftProvider defaultOutputDir={settings?.defaultOutputDir}>
      <AppRoutes
        settings={settings}
        jobs={jobs}
        jobMetrics={jobMetrics}
        templates={templates}
        ffmpegProbe={ffmpegProbe}
        encoderCapabilities={encoderCapabilities}
        loading={loading}
        error={error}
        onRefresh={() => void fetchAll()}
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

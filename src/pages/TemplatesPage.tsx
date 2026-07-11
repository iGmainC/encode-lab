import { type ReactNode, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Copy, Search, Send, Trash2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useI18n } from "../i18n/I18nProvider";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type {
  ApplyTemplateResponse,
  DuplicateTemplateResponse,
  Template,
  TemplateMutationResponse,
} from "../types/workbench";

/** 方案库页面保持的外部数据和工作台衔接契约。 */
type Props = {
  /** 可检索和检查的参数方案。 */
  templates: Template[];
  /** 写操作完成后刷新上层方案状态。 */
  onTemplatesChanged: () => void;
  /** 将方案快照应用到工作台。 */
  onApplyTemplate: (template: Template) => void;
};

/** 当前正在执行的方案写操作。 */
type PendingAction = "apply" | "duplicate" | "delete" | null;

/** 当前国际化上下文暴露的翻译函数。 */
type Translate = ReturnType<typeof useI18n>["t"];

/**
 * 提供面向专业用户的参数方案列表和只读检查器。
 * @param props 页面数据、刷新回调和工作台应用回调
 */
export function TemplatesPage({ templates, onTemplatesChanged, onApplyTemplate }: Props) {
  const { t } = useI18n();
  const desktopRuntime = isTauriRuntime();
  const [keyword, setKeyword] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filteredTemplates = useMemo(
    () => sortTemplates(templates).filter((template) => matchesTemplateKeyword(template, keyword)),
    [keyword, templates],
  );

  const selectedTemplate = filteredTemplates.find((template) => template.id === selectedTemplateId) ?? null;

  useEffect(() => {
    if (!selectedTemplateId && filteredTemplates[0]) {
      setSelectedTemplateId(filteredTemplates[0].id);
      return;
    }

    // 搜索结果变化后保持一个有效选择，避免检查器展示已被筛除的方案。
    if (selectedTemplateId && !filteredTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(filteredTemplates[0]?.id ?? null);
    }
  }, [filteredTemplates, selectedTemplateId]);

  /**
   * 应用参数方案到当前任务草稿。
   * @param templateId 参数方案 id
   */
  async function applyTemplate(templateId: string) {
    setActionError(null);
    setPendingAction("apply");
    try {
      if (!desktopRuntime) {
        const template = templates.find((item) => item.id === templateId);
        if (!template) {
          throw new Error(t("presets.action.missing"));
        }
        onApplyTemplate(template);
        return;
      }

      const result = await invoke<ApplyTemplateResponse>("apply_template", { templateId });
      onTemplatesChanged();
      onApplyTemplate(result.template);
    } catch (error) {
      setActionError(t("presets.action.applyFailed", { message: formatActionError(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * 复制参数方案并刷新列表。
   * @param templateId 参数方案 id
   */
  async function duplicateTemplate(templateId: string) {
    setActionError(null);
    setPendingAction("duplicate");
    try {
      // 浏览器预览不模拟持久化写入，避免把演示态误认为真实方案数据。
      if (!desktopRuntime) {
        setActionError(t("presets.action.copyBrowser"));
        return;
      }

      await invoke<DuplicateTemplateResponse>("duplicate_template", { templateId });
      onTemplatesChanged();
    } catch (error) {
      setActionError(t("presets.action.copyFailed", { message: formatActionError(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * 删除参数方案并刷新列表。
   * @param templateId 参数方案 id
   */
  async function deleteTemplate(templateId: string) {
    if (!window.confirm(t("presets.confirmDelete"))) {
      return;
    }

    setActionError(null);
    setPendingAction("delete");
    try {
      // 浏览器预览不改写上层样例数据，删除必须由桌面端存储命令完成。
      if (!desktopRuntime) {
        setActionError(t("presets.action.deleteBrowser"));
        return;
      }

      await invoke<TemplateMutationResponse>("delete_template", { templateId });
      setSelectedTemplateId((current) => (current === templateId ? null : current));
      onTemplatesChanged();
    } catch (error) {
      setActionError(t("presets.action.deleteFailed", { message: formatActionError(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
      <Card className="min-w-0 overflow-hidden shadow-sm">
        <CardHeader className="border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{t("presets.listTitle")}</CardTitle>
                <Badge variant="secondary" className="font-mono font-medium">
                  {filteredTemplates.length}/{templates.length}
                </Badge>
              </div>
              <CardDescription className="mt-1">{t("presets.listDescription")}</CardDescription>
            </div>

            <label className="relative block w-full lg:w-[320px]">
              <span className="sr-only">{t("presets.searchLabel")}</span>
              <Search
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("presets.searchPlaceholder")}
                autoComplete="off"
              />
              {keyword ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setKeyword("")}
                  aria-label={t("presets.clearSearch")}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </label>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="hidden min-w-[850px] grid-cols-[minmax(210px,1.5fr)_130px_128px_108px_112px_78px_102px] gap-3 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
              <div>{t("presets.column.presetTags")}</div>
              <div>Codec / Encoder</div>
              <div>Rate Control</div>
              <div>Preset</div>
              <div>Resolution</div>
              <div>Container</div>
              <div>{t("presets.column.recentUse")}</div>
            </div>

            <div className="min-w-0 divide-y lg:min-w-[850px]">
              {filteredTemplates.map((template) => {
                const isSelected = template.id === selectedTemplateId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={`grid w-full gap-3 border-l-2 px-4 py-3 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[minmax(210px,1.5fr)_130px_128px_108px_112px_78px_102px] lg:items-center ${
                      isSelected
                        ? "border-l-primary bg-primary/5"
                        : "border-l-transparent hover:bg-muted/40"
                    }`}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setActionError(null);
                    }}
                    aria-pressed={isSelected}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{template.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">v{template.version}</span>
                      </div>
                      <div className="mt-1.5 flex min-h-5 flex-wrap gap-1">
                        {template.tags.length ? (
                          template.tags.map((tag, index) => (
                            <Badge key={`${tag}-${index}`} variant="outline" className="px-1.5 py-0 font-normal">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("presets.noTags")}</span>
                        )}
                      </div>
                    </div>
                    <TemplateListCell
                      label="Codec / Encoder"
                      value={formatCodec(template)}
                      secondary={template.taskConfigSnapshot.video.encoder}
                      mono
                    />
                    <TemplateListCell
                      label="Rate Control"
                      value={formatRateControl(template)}
                      secondary={template.taskConfigSnapshot.video.enableTwoPass ? "2-pass" : "1-pass"}
                      mono
                    />
                    <TemplateListCell label="Preset" value={formatPreset(template, t)} mono />
                    <TemplateListCell label="Resolution" value={formatResolution(template, t)} mono />
                    <TemplateListCell label="Container" value={formatContainer(template)} mono />
                    <TemplateListCell
                      label={t("presets.column.recentUse")}
                      value={
                        template.lastUsedAt
                          ? formatCompactTimestamp(template.lastUsedAt, "-")
                          : t("presets.neverUsed")
                      }
                    />
                  </button>
                );
              })}

              {filteredTemplates.length === 0 ? (
                <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
                  <Search className="size-5 text-muted-foreground" aria-hidden="true" />
                  <div className="mt-3 text-sm font-medium">{t("presets.emptyTitle")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t("presets.emptyDescription")}</div>
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden shadow-sm xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-2rem)] xl:flex-col xl:self-start">
        <CardHeader className="shrink-0 border-b p-4">
          <CardTitle className="text-base">{t("presetDetail.inspectorTitle")}</CardTitle>
          <CardDescription>{t("presetDetail.inspectorDescription")}</CardDescription>
        </CardHeader>

        <CardContent className="min-h-0 space-y-4 overflow-y-auto p-4">
          {actionError ? (
            <Alert className="border-destructive/40 bg-destructive/5 text-destructive">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>{t("presetDetail.actionErrorTitle")}</AlertTitle>
              <AlertDescription className="text-destructive/90">{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {selectedTemplate ? (
            <>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold tracking-tight">{selectedTemplate.name}</h3>
                    <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      ID {selectedTemplate.id} · v{selectedTemplate.version}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {selectedTemplate.lastUsedAt ? t("presetDetail.used") : t("presetDetail.unused")}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTemplate.tags.length ? (
                    selectedTemplate.tags.map((tag, index) => (
                      <Badge key={`${tag}-${index}`} variant="outline" className="font-normal">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("presets.noTags")}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <CoreParameter label="Codec" value={formatCodec(selectedTemplate)} />
                <CoreParameter label="Encoder" value={selectedTemplate.taskConfigSnapshot.video.encoder} />
                <CoreParameter label="Rate Control" value={formatRateControl(selectedTemplate)} />
                <CoreParameter label="Preset" value={formatPreset(selectedTemplate, t)} />
                <CoreParameter label="Resolution" value={formatResolution(selectedTemplate, t)} />
                <CoreParameter label="Container" value={formatContainer(selectedTemplate)} />
              </div>

              <InspectorSection title={t("presetDetail.videoDetails")}>
                <InspectorField label="Frame Rate" value={formatFrameRate(selectedTemplate, t)} mono />
                <InspectorField
                  label="Pixel Format"
                  value={selectedTemplate.taskConfigSnapshot.video.pixelFormat ?? t("common.default")}
                  mono
                />
                <InspectorField
                  label="2-pass"
                  value={selectedTemplate.taskConfigSnapshot.video.enableTwoPass ? t("common.on") : t("common.off")}
                />
                <InspectorField
                  label="Dolby Vision"
                  value={
                    selectedTemplate.taskConfigSnapshot.video.preserveDolbyVisionMetadata
                      ? t("presetDetail.preserveMetadata")
                      : t("common.off")
                  }
                />
              </InspectorSection>

              <InspectorSection title={t("presetDetail.packageOutput")}>
                <InspectorField label="Audio" value={formatAudio(selectedTemplate)} mono />
                <InspectorField
                  label="Fast Start"
                  value={selectedTemplate.taskConfigSnapshot.container.faststart ? t("common.on") : t("common.off")}
                />
                <InspectorField
                  label="File Pattern"
                  value={selectedTemplate.taskConfigSnapshot.output.fileNamePattern || "-"}
                  mono
                />
                <InspectorField
                  label={t("presetDetail.recentUse")}
                  value={formatTimestamp(selectedTemplate.lastUsedAt, t("presets.neverUsed"))}
                />
                <InspectorField
                  label={t("presetDetail.updatedAtLabel")}
                  value={formatTimestamp(selectedTemplate.updatedAt, "-")}
                />
              </InspectorSection>

              {selectedTemplate.taskConfigSnapshot.advancedArgs ? (
                <InspectorSection title={t("presetDetail.ffmpegArgs")}>
                  <code className="block break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                    {selectedTemplate.taskConfigSnapshot.advancedArgs}
                  </code>
                </InspectorSection>
              ) : null}

              <div className="sticky bottom-0 -mx-4 -mb-4 space-y-2 border-t bg-card/95 p-4 backdrop-blur-sm">
                <Button
                  className="w-full"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void applyTemplate(selectedTemplate.id)}
                >
                  <Send data-icon="inline-start" aria-hidden="true" />
                  {pendingAction === "apply" ? t("presetDetail.applying") : t("presetDetail.applyWorkbench")}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    disabled={Boolean(pendingAction)}
                    onClick={() => void duplicateTemplate(selectedTemplate.id)}
                  >
                    <Copy data-icon="inline-start" aria-hidden="true" />
                    {pendingAction === "duplicate" ? t("presetDetail.duplicating") : t("presetDetail.duplicate")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={Boolean(pendingAction)}
                    onClick={() => void deleteTemplate(selectedTemplate.id)}
                  >
                    <Trash2 data-icon="inline-start" aria-hidden="true" />
                    {pendingAction === "delete" ? t("presetDetail.deleting") : t("presetDetail.delete")}
                  </Button>
                </div>
                {!desktopRuntime ? (
                  <p className="text-center text-[11px] leading-4 text-muted-foreground">
                    {t("presetDetail.browserHint")}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
              <div className="text-sm font-medium">{t("presetDetail.emptyTitle")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("presetDetail.emptyDescription")}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 参数方案列表排序：有使用记录的方案优先，再分别按最近使用或更新时间倒序。
 * @param templates 后端参数方案列表
 * @returns 不修改原数组的排序结果
 */
function sortTemplates(templates: Template[]) {
  return [...templates].sort((a, b) => {
    if (Boolean(a.lastUsedAt) !== Boolean(b.lastUsedAt)) {
      return a.lastUsedAt ? -1 : 1;
    }

    const aTime = Date.parse(a.lastUsedAt ?? a.updatedAt) || 0;
    const bTime = Date.parse(b.lastUsedAt ?? b.updatedAt) || 0;
    return bTime - aTime;
  });
}

/**
 * 只使用真实名称和标签匹配搜索词，不从名称推断业务用途。
 * @param template 待检查的参数方案
 * @param keyword 用户输入的搜索词；空白分隔的词需要全部命中
 * @returns 是否保留在当前结果中
 */
function matchesTemplateKeyword(template: Template, keyword: string) {
  const terms = keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return true;
  }

  const searchableText = `${template.name} ${template.tags.join(" ")}`.toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
}

/** 方案列表中的紧凑参数单元格。 */
function TemplateListCell({
  label,
  value,
  secondary,
  mono = false,
}: {
  label: string;
  value: string;
  secondary?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground lg:hidden">{label}</div>
      <div className={`truncate text-xs font-medium ${mono ? "font-mono" : ""}`}>{value}</div>
      {secondary ? (
        <div className={`mt-0.5 truncate text-[11px] text-muted-foreground ${mono ? "font-mono" : ""}`}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

/** 检查器顶部需要快速扫读的核心参数。 */
function CoreParameter({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-medium" title={value}>
        {value}
      </div>
    </div>
  );
}

/** 检查器中的参数分组。 */
function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</h4>
      <div className="divide-y rounded-lg border">{children}</div>
    </section>
  );
}

/** 检查器中的单行键值参数。 */
function InspectorField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className={`min-w-0 break-words text-right font-medium ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * 将 codec 内部枚举格式化为专业用户常用写法。
 * @param template 参数方案
 * @returns 可读 codec 名称
 */
function formatCodec(template: Template) {
  const codecLabels: Record<Template["taskConfigSnapshot"]["video"]["codecFormat"], string> = {
    h264: "H.264",
    h265: "H.265",
    av1: "AV1",
    vp9: "VP9",
    copy: "Copy",
  };
  return codecLabels[template.taskConfigSnapshot.video.codecFormat];
}

/**
 * 格式化码率控制模式，并在 CRF 模式显示数值。
 * @param template 参数方案
 * @returns 码率控制摘要
 */
function formatRateControl(template: Template) {
  const video = template.taskConfigSnapshot.video;
  if (video.bitrateMode === "CRF") {
    return `CRF ${video.crf ?? "-"}`;
  }
  return video.bitrateMode;
}

/**
 * 格式化编码 preset。
 * @param template 参数方案
 * @param t 当前界面的翻译函数
 * @returns preset 或默认语义
 */
function formatPreset(template: Template, t: Translate) {
  return template.taskConfigSnapshot.video.preset || t("common.default");
}

/**
 * 格式化输出分辨率；缺少 scale 配置时沿用跟随源文件语义。
 * @param template 参数方案
 * @param t 当前界面的翻译函数
 * @returns 分辨率摘要
 */
function formatResolution(template: Template, t: Translate) {
  const video = template.taskConfigSnapshot.video;
  if (video.keepOriginalResolution || !video.resolution) {
    return t("presetDetail.followSource");
  }
  return `${video.resolution.width} × ${video.resolution.height}`;
}

/**
 * 格式化输出帧率；缺少帧率配置时沿用跟随源文件语义。
 * @param template 参数方案
 * @param t 当前界面的翻译函数
 * @returns 帧率摘要
 */
function formatFrameRate(template: Template, t: Translate) {
  const video = template.taskConfigSnapshot.video;
  if (video.keepOriginalFps || typeof video.fps !== "number") {
    return t("presetDetail.followSource");
  }
  return `${video.fps} fps`;
}

/**
 * 格式化容器名称。
 * @param template 参数方案
 * @returns 大写容器格式
 */
function formatContainer(template: Template) {
  return template.taskConfigSnapshot.container.format.toUpperCase();
}

/**
 * 格式化音频处理方式。
 * @param template 参数方案
 * @returns 音频流处理摘要
 */
function formatAudio(template: Template) {
  return template.taskConfigSnapshot.audio.mode === "copy" ? "Stream copy" : "Custom";
}

/**
 * 格式化时间戳，保留分钟便于比较最近使用记录。
 * @param value ISO 时间戳
 * @param fallback 缺失或无效时的显示文本
 * @returns 本地化日期时间
 */
function formatTimestamp(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 为列表窄列格式化紧凑时间戳。
 * @param value ISO 时间戳
 * @param fallback 缺失或无效时的显示文本
 * @returns 不含年份的本地化日期时间
 */
function formatCompactTimestamp(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 将 Tauri invoke 或浏览器回调异常转换为可展示信息。
 * @param error 未知异常载荷
 * @returns 尽可能具体的错误描述
 */
function formatActionError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Archive, BadgeCheck, Copy, Search, Send, Trash2 } from "lucide-react";
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

type Props = {
  templateCount: number;
  taskCount: number;
  templates: Template[];
  onTemplatesChanged: () => void;
  onApplyTemplate: (template: Template) => void;
};

export function TemplatesPage({
  templateCount,
  taskCount,
  templates,
  onTemplatesChanged,
  onApplyTemplate,
}: Props) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const filteredTemplates = useMemo(
    () =>
      sortTemplates(templates).filter((item) => {
        const matchesKeyword = item.name.toLowerCase().includes(keyword.toLowerCase());
        const matchesOutcome = selectedOutcome === "all" || inferTemplateOutcome(item) === selectedOutcome;
        return matchesKeyword && matchesOutcome;
      }),
    [keyword, selectedOutcome, templates],
  );

  const selectedTemplate = filteredTemplates.find((item) => item.id === selectedTemplateId) ?? null;

  useEffect(() => {
    if (!selectedTemplateId && filteredTemplates[0]) {
      setSelectedTemplateId(filteredTemplates[0].id);
      return;
    }

    if (selectedTemplateId && !filteredTemplates.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(filteredTemplates[0]?.id ?? null);
    }
  }, [filteredTemplates, selectedTemplateId]);

  /**
   * 应用参数方案到当前任务草稿。
   * @param templateId 参数方案 id
   */
  async function applyTemplate(templateId: string) {
    setPendingAction("apply");
    try {
      if (!isTauriRuntime()) {
        const template = templates.find((item) => item.id === templateId);
        if (template) {
          onApplyTemplate(template);
        }
        return;
      }

      const result = await invoke<ApplyTemplateResponse>("apply_template", { templateId });
      onTemplatesChanged();
      onApplyTemplate(result.template);
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * 复制参数方案并刷新列表。
   * @param templateId 参数方案 id
   */
  async function duplicateTemplate(templateId: string) {
    setPendingAction("duplicate");
    try {
      if (!isTauriRuntime()) {
        return;
      }

      const result = await invoke<DuplicateTemplateResponse>("duplicate_template", { templateId });
      setSelectedTemplateId(result.templateId);
      onTemplatesChanged();
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

    setPendingAction("delete");
    try {
      if (!isTauriRuntime()) {
        setSelectedTemplateId((current) => (current === templateId ? null : current));
        return;
      }

      await invoke<TemplateMutationResponse>("delete_template", { templateId });
      setSelectedTemplateId((current) => (current === templateId ? null : current));
      onTemplatesChanged();
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="shadow-sm">
          <CardContent className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Archive className="size-4" aria-hidden="true" />
                方案资产库
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">先选用途，再回到工作台验证</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                方案库不只是模板列表，它负责沉淀可复用的编码决策：用途、取舍、兼容边界和最近使用情况。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:w-[260px]">
              <Metric label={t("presets.total")} value={String(templateCount)} />
              <Metric label={t("presets.drafts")} value={String(taskCount)} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="p-5">
            <CardTitle className="text-base">当前闭环</CardTitle>
            <CardDescription>方案必须回到工作台预览后再进入队列。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5 pt-0 text-sm">
            <ChecklistRow done label="只保存参数，不绑定源文件" />
            <ChecklistRow done label="应用后更新最近使用时间" />
            <ChecklistRow done={Boolean(selectedTemplate)} label="已选中一个可验证方案" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="shadow-sm">
          <CardHeader className="border-b p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>{t("presets.title")}</CardTitle>
                <CardDescription>{t("presets.description")}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "全部"],
                  ["web", "线上发布"],
                  ["archive", "归档保留"],
                  ["small", "小体积"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={selectedOutcome === value ? "default" : "secondary"}
                    onClick={() => setSelectedOutcome(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("presets.search")}
              />
            </label>

            <div className="divide-y rounded-lg border">
              {filteredTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`grid w-full gap-3 p-4 text-left transition lg:grid-cols-[minmax(0,1.3fr)_120px_120px_120px] lg:items-center ${
                    tpl.id === selectedTemplateId ? "bg-primary/5" : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{tpl.name}</span>
                      <OutcomeBadge value={inferTemplateOutcome(tpl)} />
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatPlanSentence(tpl)}
                    </div>
                  </div>
                  <PlanTradeoff label="质量" value={formatQuality(tpl)} />
                  <PlanTradeoff label="速度" value={formatSpeed(tpl)} />
                  <PlanTradeoff label="最近使用" value={formatDate(tpl.lastUsedAt ?? tpl.updatedAt)} />
                </button>
              ))}
              {filteredTemplates.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  {t("presets.empty")}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="border-b p-5">
            <CardTitle>当前方案决策</CardTitle>
            <CardDescription>确认用途和取舍后，回到工作台预览。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5 text-sm">
            {selectedTemplate ? (
              <>
                <div>
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
                    <div className="font-medium">{selectedTemplate.name}</div>
                  </div>
                  <p className="mt-2 leading-6 text-muted-foreground">{formatPlanSentence(selectedTemplate)}</p>
                </div>
                <div className="divide-y rounded-lg border">
                  <TemplateField label="编码器" value={selectedTemplate.taskConfigSnapshot.video.encoder} />
                  <TemplateField label={t("presetDetail.rateMode")} value={formatRateControl(selectedTemplate)} />
                  <TemplateField label={t("presetDetail.container")} value={selectedTemplate.taskConfigSnapshot.container.format.toUpperCase()} />
                  <TemplateField label={t("presetDetail.updatedAt")} value={formatDate(selectedTemplate.updatedAt)} />
                </div>
                <div className="grid gap-2">
                  <Button disabled={pendingAction === "apply"} onClick={() => void applyTemplate(selectedTemplate.id)}>
                    <Send data-icon="inline-start" aria-hidden="true" />
                    {pendingAction === "apply" ? t("presetDetail.applying") : "应用并回到工作台"}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      disabled={pendingAction === "duplicate"}
                      onClick={() => void duplicateTemplate(selectedTemplate.id)}
                    >
                      <Copy data-icon="inline-start" aria-hidden="true" />
                      {pendingAction === "duplicate" ? t("presetDetail.duplicating") : t("presetDetail.duplicate")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pendingAction === "delete"}
                      onClick={() => void deleteTemplate(selectedTemplate.id)}
                    >
                      <Trash2 data-icon="inline-start" aria-hidden="true" />
                      {pendingAction === "delete" ? t("presetDetail.deleting") : t("presetDetail.delete")}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-muted-foreground">{t("presetDetail.empty")}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * 参数方案列表排序：最近使用优先，其次按更新时间倒序。
 * @param templates 后端参数方案列表
 */
function sortTemplates(templates: Template[]) {
  return [...templates].sort((a, b) => {
    const aTime = Date.parse(a.lastUsedAt ?? a.updatedAt) || 0;
    const bTime = Date.parse(b.lastUsedAt ?? b.updatedAt) || 0;
    return bTime - aTime;
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ChecklistRow({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <Badge className={done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : ""}>
        {done ? "就绪" : "待处理"}
      </Badge>
    </div>
  );
}

function OutcomeBadge({ value }: { value: string }) {
  const labelMap: Record<string, string> = {
    web: "线上发布",
    archive: "归档",
    small: "小体积",
  };
  return <Badge variant="secondary">{labelMap[value] ?? "通用"}</Badge>;
}

function PlanTradeoff({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function TemplateField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words font-medium">{value}</div>
    </div>
  );
}

/**
 * 按方案名称和参数特征推断用户用途。
 * @param template 参数方案
 */
function inferTemplateOutcome(template: Template) {
  const haystack = `${template.name} ${template.tags.join(" ")}`.toLowerCase();
  if (haystack.includes("archive") || haystack.includes("归档")) {
    return "archive";
  }
  if (haystack.includes("small") || haystack.includes("tiny") || haystack.includes("小")) {
    return "small";
  }
  return "web";
}

function formatPlanSentence(template: Template) {
  const video = template.taskConfigSnapshot.video;
  const container = template.taskConfigSnapshot.container.format.toUpperCase();
  return `${video.codecFormat.toUpperCase()} / ${video.encoder} · ${formatRateControl(template)} · ${container}，适合先预览再确认任务。`;
}

function formatRateControl(template: Template) {
  const video = template.taskConfigSnapshot.video;
  if (video.bitrateMode === "CRF") {
    return `CRF ${video.crf ?? "-"}`;
  }
  return video.bitrateMode;
}

function formatQuality(template: Template) {
  const crf = template.taskConfigSnapshot.video.crf;
  if (typeof crf !== "number") {
    return "稳定";
  }
  return crf <= 20 ? "高" : crf <= 26 ? "均衡" : "体积优先";
}

function formatSpeed(template: Template) {
  const preset = template.taskConfigSnapshot.video.preset;
  if (!preset) {
    return "默认";
  }
  if (preset.includes("fast")) {
    return "较快";
  }
  if (preset.includes("slow")) {
    return "较慢";
  }
  return "均衡";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
}

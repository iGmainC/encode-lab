import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { TemplateDetailPanel } from "../components/workbench/TemplateDetailPanel";
import { useI18n } from "../i18n/I18nProvider";
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const filteredTemplates = useMemo(
    () => sortTemplates(templates).filter((item) => item.name.toLowerCase().includes(keyword.toLowerCase())),
    [keyword, templates],
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
      await invoke<TemplateMutationResponse>("delete_template", { templateId });
      setSelectedTemplateId((current) => (current === templateId ? null : current));
      onTemplatesChanged();
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">{t("presets.total")}</div>
            <div className="mt-2 text-3xl font-semibold">{templateCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">{t("presets.drafts")}</div>
            <div className="mt-2 text-3xl font-semibold">{taskCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>{t("presets.title")}</CardTitle>
            <CardDescription>{t("presets.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <input
                className="h-11 rounded-2xl border bg-background px-3 text-sm"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("presets.search")}
              />
              <div className="rounded-2xl border p-3 text-sm text-muted-foreground">{t("presets.tagPlaceholder")}</div>
            </div>

            <div className="space-y-3">
              {filteredTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    tpl.id === selectedTemplateId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                >
                  <div className="font-medium">{tpl.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t("presets.version", { version: tpl.version })}</div>
                </button>
              ))}
              {filteredTemplates.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                  {t("presets.empty")}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <TemplateDetailPanel
          template={selectedTemplate}
          pendingAction={pendingAction}
          onApply={(templateId) => void applyTemplate(templateId)}
          onDuplicate={(templateId) => void duplicateTemplate(templateId)}
          onDelete={(templateId) => void deleteTemplate(templateId)}
        />
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

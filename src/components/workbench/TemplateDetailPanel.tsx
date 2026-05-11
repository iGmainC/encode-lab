import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useI18n } from "../../i18n/I18nProvider";
import type { Template } from "../../types/workbench";

export function TemplateDetailPanel({
  template,
  pendingAction,
  onApply,
  onDuplicate,
  onDelete,
}: {
  template: Template | null;
  pendingAction: string | null;
  onApply: (templateId: string) => void;
  onDuplicate: (templateId: string) => void;
  onDelete: (templateId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t("presetDetail.title")}</CardTitle>
        <CardDescription>{t("presetDetail.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {template ? (
          <>
            <div className="rounded-2xl border p-4">
              <div className="font-medium">{template.name}</div>
              <div className="mt-1 text-muted-foreground">{t("presets.version", { version: template.version })}</div>
            </div>
            <div className="grid gap-3">
              <TemplateField label="Codec" value={template.taskConfigSnapshot.video.codecFormat} />
              <TemplateField label="Encoder" value={template.taskConfigSnapshot.video.encoder} />
              <TemplateField label={t("presetDetail.rateMode")} value={formatRateControl(template)} />
              <TemplateField label={t("presetDetail.container")} value={template.taskConfigSnapshot.container.format.toUpperCase()} />
              <TemplateField label={t("presetDetail.lastUsed")} value={template.lastUsedAt ?? "-"} />
              <TemplateField label={t("presetDetail.updatedAt")} value={template.updatedAt} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={pendingAction === "apply"} onClick={() => onApply(template.id)}>
                {pendingAction === "apply" ? t("presetDetail.applying") : t("presetDetail.apply")}
              </Button>
              <Button
                variant="secondary"
                disabled={pendingAction === "duplicate"}
                onClick={() => onDuplicate(template.id)}
              >
                {pendingAction === "duplicate" ? t("presetDetail.duplicating") : t("presetDetail.duplicate")}
              </Button>
              <Button
                variant="outline"
                disabled={pendingAction === "delete"}
                onClick={() => onDelete(template.id)}
              >
                {pendingAction === "delete" ? t("presetDetail.deleting") : t("presetDetail.delete")}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-6 text-muted-foreground">{t("presetDetail.empty")}</div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

/**
 * 生成参数方案码率控制摘要。
 * @param template 参数方案记录
 */
function formatRateControl(template: Template) {
  const video = template.taskConfigSnapshot.video;
  if (video.bitrateMode === "CRF") {
    return `CRF ${video.crf ?? "-"}`;
  }
  return video.bitrateMode;
}

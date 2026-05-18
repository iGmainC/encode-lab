import { Badge } from "../ui/badge";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import type { TaskDraftStep } from "../../types/workbench";

const orderedSteps: { key: TaskDraftStep; labelKey: Parameters<ReturnType<typeof useI18n>["t"]>[0] }[] = [
  { key: "source", labelKey: "step.source" },
  { key: "config", labelKey: "step.config" },
  { key: "preview", labelKey: "step.preview" },
  { key: "enqueue", labelKey: "step.enqueue" },
];

export function StepFlowHeader({
  currentStep,
}: {
  currentStep: TaskDraftStep;
}) {
  const { t } = useI18n();
  const currentIndex = orderedSteps.findIndex((item) => item.key === currentStep);

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t("step.title")}</div>
          <p className="text-sm text-muted-foreground">{t("step.description")}</p>
        </div>
        <Badge variant="outline">V1 Flow</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {orderedSteps.map((item, index) => {
          const active = index === currentIndex;
          const completed = index < currentIndex;
          return (
            <div
              key={item.key}
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                active
                  ? "border-primary bg-primary/5"
                  : completed
                    ? "border-border bg-muted/50"
                    : "border-dashed text-muted-foreground",
              )}
            >
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {t("step.label", { index: index + 1 })}
              </div>
              <div className="font-medium text-foreground">{t(item.labelKey)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

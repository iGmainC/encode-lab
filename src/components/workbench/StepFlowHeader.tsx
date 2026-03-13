import { Badge } from "../ui/badge";
import type { TaskDraftStep } from "../../types/workbench";

const orderedSteps: { key: TaskDraftStep; label: string }[] = [
  { key: "source", label: "选择源文件" },
  { key: "config", label: "配置参数" },
  { key: "preview", label: "预览校验" },
  { key: "enqueue", label: "发起转码" },
];

export function StepFlowHeader({
  currentStep,
}: {
  currentStep: TaskDraftStep;
}) {
  const currentIndex = orderedSteps.findIndex((item) => item.key === currentStep);

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">工作流向导</div>
          <p className="text-sm text-muted-foreground">在任务配置页内保持顺序引导，但不影响左侧栏自由切换。</p>
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
              className={`rounded-2xl border px-4 py-3 text-sm ${
                active
                  ? "border-primary bg-primary/5"
                  : completed
                    ? "border-border bg-muted/50"
                    : "border-dashed text-muted-foreground"
              }`}
            >
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Step {index + 1}
              </div>
              <div className="font-medium text-foreground">{item.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

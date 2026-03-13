import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { TemplateDetailPanel } from "../components/workbench/TemplateDetailPanel";
import type { Template } from "../types/workbench";

type Props = {
  templateCount: number;
  taskCount: number;
  templates: Template[];
};

export function TemplatesPage({ templateCount, taskCount, templates }: Props) {
  const [keyword, setKeyword] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id ?? null);

  const filteredTemplates = useMemo(
    () => templates.filter((item) => item.name.toLowerCase().includes(keyword.toLowerCase())),
    [keyword, templates],
  );

  const selectedTemplate = filteredTemplates.find((item) => item.id === selectedTemplateId) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">模板总数</div>
            <div className="mt-2 text-3xl font-semibold">{templateCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">任务草稿</div>
            <div className="mt-2 text-3xl font-semibold">{taskCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>模板库</CardTitle>
            <CardDescription>左侧负责搜索和列表浏览，右侧负责模板详情与直预览动作。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <input
                className="h-11 rounded-2xl border bg-background px-3 text-sm"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按模板名搜索"
              />
              <div className="rounded-2xl border p-3 text-sm text-muted-foreground">标签筛选占位</div>
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
                  <div className="mt-1 text-sm text-muted-foreground">版本 v{tpl.version}</div>
                </button>
              ))}
              {filteredTemplates.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                  没有匹配的模板。当前页后续会接标签筛选和最近使用排序。
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <TemplateDetailPanel template={selectedTemplate} />
      </div>
    </div>
  );
}

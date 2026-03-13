import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import type { Template } from "../../types/workbench";

export function TemplateDetailPanel({ template }: { template: Template | null }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>模板详情</CardTitle>
        <CardDescription>模板列表负责检索，右侧详情区负责预览和操作。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {template ? (
          <>
            <div className="rounded-2xl border p-4">
              <div className="font-medium">{template.name}</div>
              <div className="mt-1 text-muted-foreground">版本 v{template.version}</div>
            </div>
            <div className="rounded-2xl border p-4 text-muted-foreground">
              这里展示模板参数摘要、最近使用时间和保存来源。后续接模板编辑表单和直预览链路。
            </div>
            <div className="flex flex-wrap gap-2">
              <Button>直预览</Button>
              <Button variant="secondary">复制模板</Button>
              <Button variant="outline">删除</Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-6 text-muted-foreground">从左侧选择一个模板查看详情。</div>
        )}
      </CardContent>
    </Card>
  );
}

import { Film, FolderKanban, Library, PlaySquare, Settings2 } from "lucide-react";
import { NavLink } from "react-router-dom";

const iconMap = {
  "/task-config": Film,
  "/preview": PlaySquare,
  "/jobs": FolderKanban,
  "/templates": Library,
  "/settings": Settings2,
} as const;

type Item = {
  label: string;
  to: string;
};

export function AppSidebar({ items }: { items: Item[] }) {
  return (
    <aside className="w-full rounded-3xl border bg-background p-3 shadow-sm lg:w-64 lg:p-4">
      <div className="mb-6 px-3 py-2">
        <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Encode Lab</div>
        <div className="mt-2 text-xl font-semibold">Workbench</div>
        <p className="mt-2 text-sm text-muted-foreground">参数设计、预览验证、任务执行和模板复用在同一工作台完成。</p>
      </div>

      <nav className="grid gap-1">
        {items.map((item) => {
          const Icon = iconMap[item.to as keyof typeof iconMap] ?? Film;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

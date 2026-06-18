/**
 * Sidebar — navigation + the WBS spine (web-screens §0.1). Goals are top nodes
 * with a horizon tag; projects nest under each goal. Live from GET /goals; project
 * nesting + per-goal progress arrive with F4 (Project Detail) — for F1 the tree
 * shows goals with their horizon.
 */
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "@/api";
import { cn } from "@/lib/utils";

const HORIZON_LABEL: Record<string, string> = { short: "SHORT", mid: "MID", long: "LONG" };

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-bold transition-colors",
    isActive ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-1",
  );
}

export function Sidebar() {
  const goals = useQuery({ queryKey: ["goals"], queryFn: goalsApi.list });

  return (
    <aside className="flex w-[248px] flex-none flex-col border-r border-border bg-surface-1 px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-progress text-[16px] font-black text-on-accent">
          ▲
        </span>
        <span className="text-[15px] font-black">TodoMapp</span>
      </div>

      <NavLink to="/home" className={navClass}>
        <span>⌂</span>Home
      </NavLink>
      <NavLink to="/roadmap" className={navClass}>
        <span>🗺</span>Roadmap
      </NavLink>

      <div className="my-3 h-px bg-border" />

      <div className="flex items-center px-2 pb-1.5">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-text-tertiary">
          Goals
        </span>
      </div>

      {goals.isLoading && <p className="px-2 text-xs font-semibold text-text-tertiary">Loading…</p>}
      {goals.isError && (
        <p className="px-2 text-xs font-semibold text-warning">Couldn’t load goals</p>
      )}
      {goals.data?.map((g) => (
        <div
          key={g.id}
          className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[13px] font-extrabold text-text-primary"
        >
          <span className="text-progress">◎</span>
          <span className="flex-1 truncate">{g.title}</span>
          <span className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[9px] font-extrabold text-text-secondary">
            {HORIZON_LABEL[g.horizon] ?? g.horizon.toUpperCase()}
          </span>
        </div>
      ))}
      {goals.data?.length === 0 && (
        <p className="px-2 text-xs font-semibold text-text-tertiary">No goals yet.</p>
      )}

      <div className="mt-auto" />
    </aside>
  );
}

/**
 * Prototype WBS sidebar: navigation, proposal dot, goals/projects tree with
 * progress, plus functional create sheets.
 */
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Home, Map, Plus, Settings, Target } from "lucide-react";
import type { Goal, GoalHorizon, Project, ProjectWithProgress } from "@api-types";
import { goalsApi, replanApi } from "@/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";

const HORIZON_LABEL: Record<string, string> = { short: "SHORT", mid: "MID", long: "LONG" };

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-black transition-colors",
    isActive ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-1",
  );
}

export function Sidebar() {
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [projectGoal, setProjectGoal] = useState<Goal | null>(null);
  const goals = useQuery({ queryKey: ["goals"], queryFn: goalsApi.list });
  const proposals = useQuery({ queryKey: ["replan-proposals", "pending"], queryFn: () => replanApi.list("pending") });
  const hasProposal = Boolean(proposals.data?.length);

  return (
    <aside className="flex w-[268px] flex-none flex-col border-r border-border bg-surface-1 px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <span className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[9px] bg-progress text-[16px] font-black text-on-accent">
          ▲
        </span>
        <span className="text-[15px] font-black">TodoMapp</span>
      </div>

      <NavLink to="/home" className={navClass}>
        <Home size={16} />
        Home
      </NavLink>
      <NavLink to="/roadmap" className={navClass}>
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Map size={16} />
          {hasProposal && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-surface-1 bg-system [animation:pulse-soft_2.5s_ease-in-out_infinite]" />
          )}
        </span>
        Roadmap
      </NavLink>

      <div className="my-3 h-px bg-border" />

      <div className="flex items-center gap-2 px-2 pb-1.5">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-text-tertiary">
          Goals
        </span>
        <button
          type="button"
          onClick={() => setCreateGoalOpen(true)}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-[7px] text-text-tertiary hover:bg-surface-2 hover:text-progress"
          title="Add goal"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {goals.isLoading && <p className="px-2 text-xs font-semibold text-text-tertiary">Loading...</p>}
        {goals.isError && (
          <p className="px-2 text-xs font-semibold text-warning">Could not load goals</p>
        )}
        {goals.data?.map((g) => (
          <GoalNode key={g.id} goal={g} onAddProject={() => setProjectGoal(g)} />
        ))}
        {goals.data?.length === 0 && (
          <p className="px-2 text-xs font-semibold text-text-tertiary">No goals yet.</p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-black text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          <Settings size={16} />
          Settings
        </button>
      </div>

      <CreateGoalSheet open={createGoalOpen} onClose={() => setCreateGoalOpen(false)} />
      <CreateProjectSheet goal={projectGoal} onClose={() => setProjectGoal(null)} />
    </aside>
  );
}

function GoalNode({ goal, onAddProject }: { goal: Goal; onAddProject: () => void }) {
  const projects = useQuery({
    queryKey: ["goal", goal.id, "projects", "progress"],
    queryFn: () => goalsApi.listProjects(goal.id, true),
  });

  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[13px] font-extrabold text-text-primary">
        <Target size={14} className="text-progress" />
        <span className="min-w-0 flex-1 truncate">{goal.title}</span>
        <span className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[9px] font-black text-text-secondary">
          {HORIZON_LABEL[goal.horizon] ?? goal.horizon.toUpperCase()}
        </span>
        <button
          type="button"
          onClick={onAddProject}
          className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px] text-text-tertiary hover:bg-surface-2 hover:text-progress"
          title="Add project"
        >
          <Plus size={13} />
        </button>
      </div>
      {projects.data?.map((project) => (
        <ProjectLink key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectLink({ project }: { project: Project | ProjectWithProgress }) {
  const pct = "progress" in project ? project.progress.percent_done : null;
  return (
    <NavLink
      to={`/projects/${project.id}`}
      className={({ isActive }) =>
        cn(
          "ml-4 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px] font-bold transition-colors",
          isActive ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-1",
        )
      }
    >
      <FolderKanban size={14} className="text-text-tertiary" />
      <span className="truncate">{project.title}</span>
      {pct != null && <span className="font-mono text-[10px] font-black text-progress">{pct}%</span>}
      {pct != null && (
        <span className="col-span-3 ml-6 h-1 overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
        </span>
      )}
    </NavLink>
  );
}

function CreateGoalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [horizon, setHorizon] = useState<GoalHorizon>("mid");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => goalsApi.create({ title, horizon, description: description || null }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setHorizon("mid");
      void qc.invalidateQueries({ queryKey: ["goals"] });
      onClose();
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New goal"
      subtitle="Add a top-level outcome to the WBS."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            Create goal
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Goal title">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Launch the beta" />
        </Field>
        <Field label="Horizon">
          <div className="grid grid-cols-3 gap-2">
            {(["short", "mid", "long"] as GoalHorizon[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setHorizon(option)}
                className={cn(
                  "rounded-[10px] border px-3 py-2 text-xs font-black uppercase",
                  horizon === option
                    ? "border-progress bg-progress-soft text-progress"
                    : "border-border bg-bg text-text-tertiary hover:bg-surface-2",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function CreateProjectSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [capacity, setCapacity] = useState("2");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      goalsApi.createProject(goal!.id, {
        title,
        capacity_hours_per_day: Number(capacity) || 2,
        description: description || null,
      }),
    onSuccess: () => {
      setTitle("");
      setCapacity("2");
      setDescription("");
      void qc.invalidateQueries({ queryKey: ["goal", goal?.id, "projects"] });
      void qc.invalidateQueries({ queryKey: ["goals"] });
      onClose();
    },
  });

  return (
    <Sheet
      open={Boolean(goal)}
      onClose={onClose}
      title="New project"
      subtitle={goal ? `Under ${goal.title}` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            Create project
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Project title">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Build onboarding" />
        </Field>
        <Field label="Daily capacity">
          <Input
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

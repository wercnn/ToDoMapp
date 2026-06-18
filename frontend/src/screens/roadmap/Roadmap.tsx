/**
 * Roadmap — the day-granular path (web-screens §D). Renders GET /roadmap: the
 * persisted ∪ projected days in date order as a vertical step path, milestones as
 * landmark rows at their projected_date, and a "you are here" marker at today.
 *
 * Principle 1: this screen is PURE DISPLAY. It never fabricates or auto-confirms a
 * day — a day becomes confirmed only via the deliberate confirm click in the day
 * drawer. Projected days are flagged distinctly (dashed/ghost) from real ones.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flag, MapPin, RefreshCw } from "lucide-react";
import type { Roadmap as RoadmapDto, RoadmapDay } from "@api-types";
import { replanApi, roadmapApi } from "@/api";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { cn } from "@/lib/utils";
import { calmMessage } from "@/lib/apiError";
import { DayDrawer } from "./DayDrawer";
import { ReplanReview } from "./ReplanReview";
import { formatDay } from "./dates";

/** A chronological entry: a day-step or a milestone landmark. */
type Entry =
  | { kind: "day"; date: string; day: RoadmapDay }
  | { kind: "milestone"; date: string; id: string };

function buildTimeline(data: RoadmapDto): { entries: Entry[]; undated: string[] } {
  const entries: Entry[] = data.days.map((day) => ({ kind: "day", date: day.date, day }));
  const undated: string[] = [];
  for (const ms of data.milestones) {
    if (ms.projected_date) entries.push({ kind: "milestone", date: ms.projected_date, id: ms.id });
    else undated.push(ms.id);
  }
  // Chronological; a milestone sorts AFTER the day it lands on (landmark closes the day).
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.kind === "milestone" && b.kind === "day" ? 1 : a.kind === "day" && b.kind === "milestone" ? -1 : 0;
  });
  return { entries, undated };
}

const DAY_PILL: Record<RoadmapDay["status"], StatusKind> = {
  proposed: "proposed",
  confirmed: "confirmed",
  completed: "completed",
  slipped: "slipped",
  projected: "open",
};

export function Roadmap() {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [replanning, setReplanning] = useState(false);

  const roadmap = useQuery({ queryKey: ["roadmap"], queryFn: () => roadmapApi.get() });
  const pending = useQuery({ queryKey: ["replan-proposals", "pending"], queryFn: () => replanApi.list("pending") });

  const timeline = useMemo(() => (roadmap.data ? buildTimeline(roadmap.data) : null), [roadmap.data]);
  const today = roadmap.data?.position.today ?? null;
  const pendingProposal = pending.data?.[0] ?? null;

  async function requestReplan() {
    setReplanError(null);
    setReplanning(true);
    try {
      const proposal = await replanApi.create();
      await pending.refetch();
      setReviewId(proposal.id);
    } catch (err) {
      setReplanError(calmMessage(err));
    } finally {
      setReplanning(false);
    }
  }

  if (roadmap.isLoading) {
    return <div className="p-6 text-sm font-bold text-text-tertiary">Loading your roadmap…</div>;
  }
  if (roadmap.isError || !timeline) {
    return <div className="p-6 text-sm font-bold text-warning">{calmMessage(roadmap.error)}</div>;
  }
  if (timeline.entries.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-black">Roadmap</h2>
        <p className="mt-2 text-sm font-semibold text-text-tertiary">
          No days on your path yet. Finish onboarding to propose your first days.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">Roadmap</h2>
          <p className="mt-0.5 text-xs font-semibold text-text-tertiary">
            Your path, day by day. Confirmed days are committed; faded days are a projection.
          </p>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          {pendingProposal ? (
            <Button variant="system" size="sm" onClick={() => setReviewId(pendingProposal.id)}>
              Review proposal
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={requestReplan} disabled={replanning}>
              <RefreshCw size={14} className={cn(replanning && "animate-spin")} />
              {replanning ? "Analyzing…" : "Replan"}
            </Button>
          )}
          {replanError && <span className="text-[11px] font-semibold text-warning">{replanError}</span>}
        </div>
      </div>

      <ol className="relative">
        {/* the connector rail */}
        <span className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-border" aria-hidden />
        {timeline.entries.map((entry) =>
          entry.kind === "day" ? (
            <DayNode
              key={`day-${entry.date}`}
              day={entry.day}
              isToday={entry.date === today}
              onOpen={() => setOpenDate(entry.date)}
            />
          ) : (
            <MilestoneNode key={`ms-${entry.id}-${entry.date}`} date={entry.date} />
          ),
        )}
      </ol>

      {timeline.undated.length > 0 && (
        <p className="mt-4 pl-9 text-[11px] font-semibold text-text-tertiary">
          {timeline.undated.length} milestone{timeline.undated.length === 1 ? "" : "s"} not yet datable
          (no scheduled work).
        </p>
      )}

      <DayDrawer date={openDate} onClose={() => setOpenDate(null)} today={today} />
      <ReplanReview proposalId={reviewId} onClose={() => setReviewId(null)} />
    </div>
  );
}

function DayNode({ day, isToday, onOpen }: { day: RoadmapDay; isToday: boolean; onOpen: () => void }) {
  const { weekday, rest } = formatDay(day.date);
  const projected = day.projected;
  const count = day.items.length;
  const doneCount = day.items.filter((i) => i.status === "completed").length;

  return (
    <li className="relative flex items-stretch gap-3 pb-3">
      <span
        className={cn(
          "relative z-10 mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 text-[10px] font-black",
          isToday
            ? "border-progress bg-progress text-on-accent"
            : projected
              ? "border-dashed border-border-strong bg-bg text-text-tertiary"
              : "border-border-strong bg-surface-2 text-text-secondary",
        )}
        aria-hidden
      >
        {isToday ? <MapPin size={14} /> : doneCount > 0 ? `${doneCount}/${count}` : count || ""}
      </span>
      <button
        onClick={onOpen}
        className={cn(
          "flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-surface-2",
          isToday ? "border-progress bg-progress-soft/40" : "border-border bg-surface",
          projected && "border-dashed opacity-80",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-text-primary">{rest}</span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
              {weekday}
            </span>
            {isToday && (
              <span className="text-[10px] font-black uppercase tracking-wider text-progress">
                You are here
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs font-semibold text-text-tertiary">
            {count === 0 ? "No tasks" : `${count} task${count === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="ml-auto flex flex-none items-center gap-1.5">
          {day.is_locked && <StatusPill status="locked" />}
          <StatusPill status={DAY_PILL[day.status]} label={day.projected ? "Projected" : undefined} />
        </div>
      </button>
    </li>
  );
}

function MilestoneNode({ date }: { date: string }) {
  const { rest } = formatDay(date);
  return (
    <li className="relative flex items-center gap-3 pb-3">
      <span
        className="relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 border-system bg-system-soft text-system"
        aria-hidden
      >
        <Flag size={14} />
      </span>
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-system/40 bg-system-soft/40 px-4 py-2.5">
        <span className="text-xs font-black uppercase tracking-wide text-system">Milestone</span>
        <span className="ml-auto text-xs font-bold text-text-secondary">~{rest}</span>
        <span className="text-[10px] font-semibold text-text-tertiary">projection</span>
      </div>
    </li>
  );
}

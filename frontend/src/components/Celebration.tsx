/**
 * Milestone Celebration (web-screens §E, Decision #15) — the one big moment.
 *
 * Trigger: it keys ONLY off the `milestone_achieved` field of the POST
 * /tasks/{id}/complete response (CompleteTaskResult). The backend sets
 * `milestone.achieved_at` exactly once and awards the bonus once, so that field is
 * present on the single completion that crosses the milestone and never again
 * (re-completion / reopen never re-emit it, api-endpoints.md §8). The UI therefore
 * just reacts to the response.
 *
 * No double-fire: `celebrate(payload)` is called imperatively from the completion
 * mutation's onSuccess — the only call path. Completion is a POST mutation (never a
 * query), so it is never refetched and onSuccess runs exactly once per click.
 * Re-renders and morning-brief refetches cannot re-open the dialog.
 *
 * Recap source (no fabricated fields): title + bonus points come from the response;
 * the updated points/streak and "what's next" come from the existing /morning-brief
 * query, which `celebrate` refetches (it also refetches /roadmap so the landmark
 * lights up). The animation is a CSS keyframe, so prefers-reduced-motion is honored
 * by the global rule in index.css — no JS-timed motion here.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flag, Sparkles } from "lucide-react";
import { morningBriefApi } from "@/api";
import { Button } from "@/components/ui/button";

export interface MilestoneWin {
  milestoneId: string;
  title: string;
  bonusPoints: number;
}

interface CelebrationCtx {
  celebrate: (win: MilestoneWin) => void;
}

const Ctx = createContext<CelebrationCtx | null>(null);

export function useCelebration(): CelebrationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCelebration must be used within <CelebrationProvider>");
  return ctx;
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [win, setWin] = useState<MilestoneWin | null>(null);
  // Belt-and-suspenders: the backend already emits `milestone_achieved` exactly once
  // (achieved_at set once; absent on re-completion/reopen) and we fire from the POST
  // mutation's onSuccess, so a re-render/refetch can't reopen this. This Set additionally
  // guards against any accidental double-call for the same milestone within the session.
  const celebratedIds = useRef<Set<string>>(new Set());

  const celebrate = useCallback(
    (next: MilestoneWin) => {
      if (celebratedIds.current.has(next.milestoneId)) return;
      celebratedIds.current.add(next.milestoneId);
      // Refresh the reads the recap + roadmap landmark read from.
      void qc.invalidateQueries({ queryKey: ["morning-brief"] });
      void qc.invalidateQueries({ queryKey: ["roadmap"] });
      setWin(next);
    },
    [qc],
  );

  return (
    <Ctx.Provider value={{ celebrate }}>
      {children}
      {win && <CelebrationDialog win={win} onClose={() => setWin(null)} />}
    </Ctx.Provider>
  );
}

function CelebrationDialog({ win, onClose }: { win: MilestoneWin; onClose: () => void }) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Updated stats + "what's next" from the brief `celebrate` just refetched.
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });
  const next = brief.data?.next_milestone ?? null;
  const stats = brief.data?.stats ?? null;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebration-title"
    >
      <div
        className="absolute inset-0 bg-[var(--scrim-strong)] [animation:fade-in_240ms_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-[430px] overflow-hidden rounded-[18px] border border-system/50 bg-surface-1 p-6 shadow-2xl [animation:celebrate_800ms_cubic-bezier(0.16,1,0.3,1)]">
        <Confetti />

        <div className="relative mx-auto mb-4 grid h-20 w-20 place-items-center">
          <span className="absolute h-16 w-16 rotate-45 rounded-[12px] border border-system bg-system-soft" />
          <span className="relative grid h-12 w-12 place-items-center rounded-full bg-system text-on-accent [animation:pop_600ms_ease-out]">
            <Flag size={24} strokeWidth={2.5} />
          </span>
        </div>

        <p className="text-center text-[11px] font-extrabold uppercase tracking-[0.16em] text-system">
          Milestone reached
        </p>
        <h2 id="celebration-title" className="mt-1 text-center text-2xl font-black leading-tight text-text-primary">
          {win.title}
        </h2>

        {stats && (
          <div className="mt-5 grid gap-2 border-t border-border pt-4">
            <RecapRow label="Bonus earned" value={`+${win.bonusPoints} points`} accent />
            <RecapRow label="Total points" value={String(stats.total_points)} />
            <RecapRow label="Current streak" value={`${stats.current_streak} days`} />
          </div>
        )}

        <div className="mt-5 rounded-[14px] border border-system/40 bg-system-soft px-4 py-3 text-left">
          <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-system">
            <Sparkles size={13} />
            Next landmark
          </p>
          {next ? (
            <div className="mt-2 flex items-start gap-3">
              <span className="grid h-9 w-9 rotate-45 place-items-center rounded-[8px] border border-system bg-bg">
                <Flag size={14} className="-rotate-45 text-system" />
              </span>
              <p className="min-w-0 flex-1 text-sm font-bold text-text-primary">
                {next.title}
                <span className="block text-xs font-semibold text-system">
                  {next.projected_date} · in {next.days_away} day{next.days_away === 1 ? "" : "s"}
                </span>
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-text-secondary">
              No milestones ahead. Set the next landmark when you are ready.
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onClose();
              navigate("/roadmap");
            }}
          >
            See what's next <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecapRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-bg px-3 py-2">
      <span className="text-xs font-bold text-text-tertiary">{label}</span>
      <span className={accent ? "font-mono text-sm font-black text-progress" : "font-mono text-sm font-black text-text-primary"}>
        {value}
      </span>
    </div>
  );
}

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 14 }).map((_, index) => (
        <span
          key={index}
          className="absolute h-1.5 w-1.5 rounded-[2px] [animation:celebrate_800ms_cubic-bezier(0.16,1,0.3,1)]"
          style={{
            left: `${8 + ((index * 17) % 84)}%`,
            top: `${8 + ((index * 23) % 36)}%`,
            background: index % 3 === 0 ? "var(--accent-progress)" : index % 3 === 1 ? "var(--accent-system)" : "var(--warning)",
            transform: `rotate(${index * 21}deg)`,
          }}
        />
      ))}
    </div>
  );
}

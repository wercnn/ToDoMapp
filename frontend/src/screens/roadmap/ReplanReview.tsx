/**
 * ReplanReview — the human-in-the-loop core (web-screens §D). Renders a proposal's
 * structured diff in THREE separated sections and turns the user's review into the
 * exact approve body via buildApproveEdits (the keystone):
 *   1. Moves           — regular reschedules, each with an Include toggle.
 *   2. Milestone impacts — DESCRIPTIVE ONLY ("projection, not committed").
 *   3. Time-fixed conflicts — a required per-conflict decision (never auto-moved).
 *
 * Principle 1, structurally: Approve is disabled until EVERY time-fixed conflict has
 * a decision (force-resolve-all), and a move for a time-fixed task is only ever built
 * alongside its resolution — so the backend's guard #4 (422) can't be tripped from
 * here. Reject leaves the plan untouched.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TimeFixedDecision } from "@/lib/buildApproveEdits";
import { allConflictsResolved, buildApproveEdits } from "@/lib/buildApproveEdits";
import { replanApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { calmMessage } from "@/lib/apiError";
import { TimeFixedConflictControl } from "./TimeFixedConflictControl";

export function ReplanReview({
  proposalId,
  onClose,
}: {
  proposalId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, TimeFixedDecision | undefined>>({});
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["replan-proposal", proposalId],
    queryFn: () => replanApi.get(proposalId as string),
    enabled: proposalId != null,
  });

  const changes = detail.data?.changes;
  const conflicts = changes?.time_fixed_conflicts ?? [];
  const nothingToChange =
    changes != null &&
    changes.moves.length === 0 &&
    changes.milestone_impacts.length === 0 &&
    conflicts.length === 0;

  // Only fully-decided conflicts count toward the gate (undefined = unresolved).
  const definedDecisions = useMemo(() => {
    const out: Record<string, TimeFixedDecision> = {};
    for (const [k, v] of Object.entries(decisions)) if (v) out[k] = v;
    return out;
  }, [decisions]);
  const ready = changes != null && allConflictsResolved(conflicts, definedDecisions);

  function reset() {
    setExcluded(new Set());
    setDecisions({});
    setError(null);
  }
  function handleClose() {
    reset();
    onClose();
  }
  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["roadmap"] });
    void qc.invalidateQueries({ queryKey: ["replan-proposals"] });
    void qc.invalidateQueries({ queryKey: ["morning-brief"] });
    void qc.invalidateQueries({ queryKey: ["day"] });
  }

  const approve = useMutation({
    mutationFn: async () => {
      if (!changes || !proposalId) throw new Error("not ready");
      const built = buildApproveEdits({ changes, excludedMoveTaskIds: excluded, decisions: definedDecisions });
      return built.edited ? replanApi.approve(proposalId, built.edits) : replanApi.approve(proposalId);
    },
    onMutate: () => setError(null),
    onError: (err) => setError(calmMessage(err)),
    onSuccess: () => {
      invalidate();
      handleClose();
    },
  });

  const reject = useMutation({
    mutationFn: () => replanApi.reject(proposalId as string),
    onMutate: () => setError(null),
    onError: (err) => setError(calmMessage(err)),
    onSuccess: () => {
      invalidate();
      handleClose();
    },
  });

  if (proposalId == null) return null;

  function toggleMove(taskId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  const busy = approve.isPending || reject.isPending;

  return (
    <Sheet
      open
      onClose={handleClose}
      width="max-w-lg"
      title="Review proposal"
      subtitle={detail.data?.proposal.summary}
      footer={
        <div className="space-y-2">
          {error && <p className="text-xs font-semibold text-warning">{error}</p>}
          {conflicts.length > 0 && !ready && (
            <p className="text-[11px] font-semibold text-text-tertiary">
              Decide every time-fixed conflict to approve.
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => reject.mutate()} disabled={busy}>
              Reject
            </Button>
            <Button size="sm" onClick={() => approve.mutate()} disabled={busy || !ready}>
              {approve.isPending ? "Applying…" : "Approve"}
            </Button>
          </div>
        </div>
      }
    >
      {detail.isLoading && <p className="text-sm font-bold text-text-tertiary">Loading proposal…</p>}
      {detail.isError && <p className="text-sm font-bold text-warning">{calmMessage(detail.error)}</p>}

      {nothingToChange && (
        <EmptyState
          title="Nothing to change"
          hint="Your plan already lines up — there are no reschedules or conflicts to review. You can reject this proposal to dismiss it."
        />
      )}

      {changes && !nothingToChange && (
        <div className="space-y-6">
          {/* 1. Moves */}
          <Section title="Reschedules" count={changes.moves.length}>
            {changes.moves.length === 0 ? (
              <Empty>No task moves.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {changes.moves.map((m) => (
                  <li
                    key={m.task_id}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={!excluded.has(m.task_id)}
                      onChange={() => toggleMove(m.task_id)}
                      className="h-4 w-4 flex-none accent-[var(--accent-progress)]"
                      aria-label="Include this move"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-secondary">
                      {m.task_id.slice(0, 8)}…
                    </span>
                    <span className="flex-none font-mono text-[11px] font-bold text-text-tertiary">
                      {m.from_date ?? "—"} → {m.to_date ?? "removed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 2. Milestone impacts — descriptive only */}
          <Section title="Milestone impact" count={changes.milestone_impacts.length}>
            <p className="mb-2 text-[11px] font-semibold text-text-tertiary">
              Projection — not committed. Confirming days is what moves a milestone.
            </p>
            {changes.milestone_impacts.length === 0 ? (
              <Empty>No milestone shifts.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {changes.milestone_impacts.map((ms) => (
                  <li
                    key={ms.milestone_id}
                    className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-secondary">
                      {ms.title || "Milestone"}
                    </span>
                    <span className="flex-none font-mono text-[11px] font-bold text-text-tertiary">
                      {ms.from_projected_date ?? "—"} → {ms.to_projected_date ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 3. Time-fixed conflicts — required decisions */}
          <Section title="Time-fixed conflicts" count={conflicts.length}>
            {conflicts.length === 0 ? (
              <Empty>No time-fixed conflicts.</Empty>
            ) : (
              <div className="space-y-2">
                {conflicts.map((c) => (
                  <TimeFixedConflictControl
                    key={c.task_id}
                    conflict={c}
                    onChange={(decision) =>
                      setDecisions((prev) => ({ ...prev, [c.task_id]: decision }))
                    }
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </Sheet>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text-tertiary">
        {title}
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-text-secondary">
          {count}
        </span>
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-text-tertiary">{children}</p>;
}

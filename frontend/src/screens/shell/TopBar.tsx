/**
 * Pinned top bar — the always-present "Today" summary (web-screens §0.2): daily
 * progress ring, streak, points, and the lilac proposal dot (only when a proposal
 * is pending). Live from GET /morning-brief (stats + today + pending_proposal).
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { morningBriefApi } from "@/api";
import { useSession } from "@/auth/session";
import { Button } from "@/components/ui/button";

export function TopBar() {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });

  const items = brief.data?.today?.items ?? [];
  const total = items.length;
  const done = items.filter((i) => i.item.status === "completed").length;
  const stats = brief.data?.stats;
  const pending = brief.data?.pending_proposal;

  return (
    <header className="flex h-[62px] flex-none items-center gap-4 border-b border-border bg-bg px-5">
      {/* progress ring */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border-2 border-progress text-[10px] font-bold text-progress">
          {total ? `${done}/${total}` : "–"}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
          Today
        </span>
      </div>

      <span className="h-7 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        <span>🔥</span>
        <span className="text-sm font-extrabold">{stats?.current_streak ?? 0}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-progress" />
        <span className="font-mono text-xs font-bold text-progress">{stats?.total_points ?? 0}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {pending && (
          <button
            onClick={() => navigate("/roadmap")}
            className="inline-flex items-center gap-1.5 rounded-full bg-system-soft px-3 py-1.5 text-[11px] font-extrabold text-system hover:brightness-110"
          >
            <span className="h-[7px] w-[7px] rounded-full bg-system" />
            Proposal to review
          </button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </header>
  );
}

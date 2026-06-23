/**
 * Demo seeder — fills a real user's workspace with a realistic multi-goal WBS
 * (goals → projects w/ deadlines → milestones → work packages → tasks, plus
 * dependencies and a few time-fixed tasks), then proposes + confirms a roadmap so
 * Home and the Roadmap screen show live data.
 *
 * Uses the real /v1 endpoints (via a password-grant token) so planner/roadmap
 * state is coherent — exactly what the UI reads. DB access is used only to clear
 * the workspace's prior demo content first (there is no day-delete endpoint).
 *
 * Run: npx tsx scripts/seed-demo.ts
 */
import { loadEnv } from "./env";
import { createDb } from "../src/db/kysely";

const env = loadEnv();
const BASE = process.env.F4_API_BASE ?? "http://localhost:3000/v1";
const ORIGIN = "http://localhost:5173";
const SUPABASE_URL = env.SUPABASE_URL!;
const ANON = env.SUPABASE_ANON_KEY!;

const EMAIL = "walk@example.com";
const PASSWORD = "WalkTest1234!";
const TODAY = "2026-06-23";

let token = "";
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 204 / non-JSON */
  }
  if (res.status >= 400) console.log(`  ! ${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return { status: res.status, json };
}

// ---- content model ----------------------------------------------------------
type T = { title: string; hours?: number; difficulty?: "low" | "mid" | "high"; fixed?: string };
type WP = { title: string; milestone?: string; tasks: T[]; after?: string };
type Proj = {
  title: string;
  capacity: number;
  end: string;
  milestones: string[];
  wps: WP[];
};
type G = { title: string; horizon: "short" | "mid" | "long"; projects: Proj[] };

const GOALS: G[] = [
  {
    title: "Launch freelance design studio",
    horizon: "mid",
    projects: [
      {
        title: "Portfolio website",
        capacity: 4,
        end: "2026-08-15",
        milestones: ["Site live", "Case studies published"],
        wps: [
          {
            title: "Design system",
            milestone: "Site live",
            tasks: [
              { title: "Pick type scale & palette", hours: 2 },
              { title: "Build component library", difficulty: "high" },
              { title: "Dark & light themes", hours: 3 },
            ],
          },
          {
            title: "Content & case studies",
            milestone: "Case studies published",
            tasks: [
              { title: "Collect 3 reference sites", hours: 0.5 },
              { title: "Outline portfolio structure", hours: 1 },
              { title: "Write case study #1 draft", hours: 3 },
              { title: "Write case study #2 draft", difficulty: "mid" },
            ],
          },
          {
            title: "Build & deploy",
            milestone: "Site live",
            after: "Design system",
            tasks: [
              { title: "Scaffold Next.js app", hours: 2 },
              { title: "Implement core pages", difficulty: "high" },
              { title: "Publish launch announcement", hours: 1, fixed: "2026-07-13" },
            ],
          },
        ],
      },
      {
        title: "Client outreach",
        capacity: 2,
        end: "2026-09-12",
        milestones: ["First 5 leads"],
        wps: [
          {
            title: "Outreach list",
            milestone: "First 5 leads",
            tasks: [
              { title: "Define ideal client profile", hours: 1 },
              { title: "Build list of 30 prospects", hours: 2 },
            ],
          },
          {
            title: "Cold emails",
            milestone: "First 5 leads",
            tasks: [
              { title: "Draft email templates", hours: 1.5 },
              { title: "Send batch 1 (10 emails)", hours: 1, fixed: "2026-06-26" },
              { title: "Follow up batch 1", difficulty: "low" },
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Get fit",
    horizon: "long",
    projects: [
      {
        title: "Run a 5K",
        capacity: 1,
        end: "2026-10-01",
        milestones: ["First 5K run"],
        wps: [
          {
            title: "Base building",
            milestone: "First 5K run",
            tasks: [
              { title: "Couch-to-5K week 1", difficulty: "low" },
              { title: "Couch-to-5K week 2", difficulty: "low" },
              { title: "Buy proper running shoes", hours: 1 },
            ],
          },
          {
            title: "Race prep",
            milestone: "First 5K run",
            tasks: [
              { title: "Register for local 5K", hours: 0.5, fixed: "2026-07-04" },
              { title: "Practice race-pace run", difficulty: "mid" },
            ],
          },
        ],
      },
    ],
  },
];

function estBody(t: { hours?: number; difficulty?: string }) {
  if (t.hours != null) return { estimate_hours: t.hours };
  if (t.difficulty != null) return { difficulty: t.difficulty };
  return {};
}
function fixedBody(fixed?: string) {
  return fixed ? { is_time_fixed: true, fixed_date: fixed } : {};
}

async function main() {
  // --- token ---
  const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  token = grant.access_token;
  if (!token) throw new Error(`No token for ${EMAIL}: ${JSON.stringify(grant)}`);
  console.log(`Authenticated as ${EMAIL}.`);

  // --- bootstrap (idempotent) + resolve workspace for cleanup ---
  const boot = await api("POST", "/auth/bootstrap", { email: EMAIL });
  const workspaceId: string = boot.json.workspace.id;

  // --- clear prior demo content (goals cascade) + stale roadmap days ---
  const db = createDb(env.DIRECT_URL!);
  try {
    const goals = await api("GET", "/goals");
    for (const g of goals.json ?? []) await api("DELETE", `/goals/${g.id}`);
    const deletedDays = await db
      .deleteFrom("daily_plan_day")
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    console.log(
      `Cleared ${goals.json?.length ?? 0} existing goals + ${Number(deletedDays.numDeletedRows)} roadmap days.`,
    );
  } finally {
    await db.destroy();
  }

  // --- build the WBS ---
  let goalCount = 0,
    projCount = 0,
    wpCount = 0,
    taskCount = 0,
    depCount = 0;
  for (const g of GOALS) {
    const goal = await api("POST", "/goals", { title: g.title, horizon: g.horizon });
    goalCount++;
    for (const p of g.projects) {
      const proj = await api("POST", `/goals/${goal.json.id}/projects`, {
        title: p.title,
        capacity_hours_per_day: p.capacity,
        target_end_date: p.end,
      });
      projCount++;
      const projectId = proj.json.id;

      const msIds: Record<string, string> = {};
      for (const m of p.milestones) {
        const ms = await api("POST", `/projects/${projectId}/milestones`, { title: m });
        msIds[m] = ms.json.id;
      }

      const wpIds: Record<string, string> = {};
      for (const wp of p.wps) {
        const created = await api("POST", `/projects/${projectId}/work-packages`, {
          title: wp.title,
          ...(wp.milestone ? { milestone_id: msIds[wp.milestone] } : {}),
        });
        wpCount++;
        wpIds[wp.title] = created.json.work_package.id;
        for (const t of wp.tasks) {
          await api("POST", `/work-packages/${created.json.work_package.id}/tasks`, {
            title: t.title,
            ...estBody(t),
            ...fixedBody(t.fixed),
          });
          taskCount++;
        }
      }
      // WP dependencies (after → this)
      for (const wp of p.wps) {
        if (wp.after && wpIds[wp.after]) {
          const r = await api("POST", "/work-package-dependencies", {
            predecessor_wp_id: wpIds[wp.after],
            successor_wp_id: wpIds[wp.title],
          });
          if (r.status === 201) depCount++;
        }
      }
    }
  }
  console.log(
    `Created ${goalCount} goals, ${projCount} projects, ${wpCount} work packages, ${taskCount} tasks, ${depCount} WP deps.`,
  );

  // --- propose + confirm a roadmap ---
  // propose excludes already-planned tasks, so it must run ONCE on a clean slate
  // (no persisted plan days). Defensively re-clear days right before proposing.
  {
    const db2 = createDb(env.DIRECT_URL!);
    try {
      await db2.deleteFrom("daily_plan_day").where("workspace_id", "=", workspaceId).execute();
    } finally {
      await db2.destroy();
    }
  }
  const proposed = await api("POST", "/roadmap/propose", { horizon_days: 21 });
  const days: string[] = (proposed.json ?? []).map((d: any) => d.day.plan_date).sort();
  let confirmed = 0;
  for (const date of days.slice(0, 7)) {
    const c = await api("POST", `/days/${date}/confirm`);
    if (c.status === 200 || c.status === 201) confirmed++;
  }
  console.log(`Roadmap: ${days.length} days proposed, confirmed the first ${confirmed}.`);
  console.log(`\n✅ Done. Log in as ${EMAIL} to see it.`);
}

main().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});

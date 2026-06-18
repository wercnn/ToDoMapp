/**
 * F4 live cross-origin walk — exercises the EXACT /v1 endpoints the Project Detail
 * UI calls, with a real ES256 token from a throwaway Supabase user and an `Origin`
 * header on every request (cross-origin like the deployed SPA). Compile-green can't
 * verify these; the two keystones (Flow cycle-409, Timeline drag→proposal) depend on
 * the server contracts proven here.
 *
 * Run: npx tsx scripts/f4-walk.ts   (needs the dev server on :3000)
 * Cleans up the throwaway user at the end.
 */
import { loadEnv } from "./env";
import { createDb } from "../src/db/kysely";
import { teardownWorkspace } from "../src/testing/fixtures";

const env = loadEnv();

const BASE = process.env.F4_API_BASE ?? "http://localhost:3000/v1";
const ORIGIN = "http://localhost:5173";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

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
    /* non-JSON (e.g. 204) */
  }
  if (res.status >= 400) console.log(`    · ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, json, cors: res.headers.get("access-control-allow-origin") };
}

async function main() {
  const email = `f4walk_${Date.now()}@example.com`;
  const password = "F4WalkTest1234!";
  let userId = "";
  // Domain rows to tear down at the end (auth-user deletion does NOT cascade to them).
  let domain: { userId: string; workspaceId: string } | null = null;

  try {
    // --- provision throwaway user (admin) + ES256 token (password grant) ---
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true }),
    }).then((r) => r.json());
    userId = created.id;
    console.log(`\nThrowaway user: ${email} (${userId})`);

    const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
    token = grant.access_token;
    const header = token.split(".")[0] ?? "";
    const alg = JSON.parse(Buffer.from(header, "base64url").toString()).alg;
    check("ES256 access token", alg === "ES256", `alg=${alg}`);

    // --- bootstrap workspace ---
    const boot = await api("POST", "/auth/bootstrap", { email });
    check("bootstrap", boot.status === 200 || boot.status === 201, `status=${boot.status}`);
    check("CORS origin echoed", boot.cors === ORIGIN, `acao=${boot.cors}`);
    if (boot.json?.workspace?.id && boot.json?.user?.id)
      domain = { workspaceId: boot.json.workspace.id, userId: boot.json.user.id };

    // --- build a tiny WBS the F4 UI would render: goal→project→2 WPs, tasks ---
    const goal = await api("POST", "/goals", { title: "F4 walk goal", horizon: "mid" });
    const goalId = goal.json.id;
    const project = await api("POST", `/goals/${goalId}/projects`, {
      title: "F4 walk project",
      capacity_hours_per_day: 4,
    });
    const projectId = project.json.id;
    check("project created", !!projectId, `id=${projectId?.slice(0, 8)}`);

    const wpA = await api("POST", `/projects/${projectId}/work-packages`, { title: "WP A", estimate_hours: 3 });
    const wpB = await api("POST", `/projects/${projectId}/work-packages`, { title: "WP B", difficulty: "mid" });
    const wpAId = wpA.json.work_package.id;
    const wpBId = wpB.json.work_package.id;
    check("WP create (no replan pre-confirm)", !wpA.json.replan_proposal, "no proposal before any confirmed day");

    const t1 = await api("POST", `/work-packages/${wpAId}/tasks`, { title: "T1", estimate_hours: 2 });
    const t2 = await api("POST", `/work-packages/${wpAId}/tasks`, { title: "T2", estimate_hours: 1 });
    const t3 = await api("POST", `/work-packages/${wpBId}/tasks`, { title: "T3", difficulty: "low" });
    const [t1Id, t2Id, t3Id] = [t1.json.id, t2.json.id, t3.json.id];
    check("tasks created", !!(t1Id && t2Id && t3Id));

    // === TABLE reads (the WBS + derived_status the Table renders) ===
    console.log("\n[Table view reads]");
    const prog = await api("GET", `/projects/${projectId}?include=progress`);
    check("GET project ?include=progress", prog.status === 200 && "progress" in prog.json, `${prog.json?.progress?.tasks_total} tasks`);
    const wpList = await api("GET", `/projects/${projectId}/work-packages`);
    check("GET work-packages w/ derived_status", wpList.status === 200 && wpList.json.every((w: any) => "derived_status" in w), `${wpList.json?.length} WPs`);
    const taskList = await api("GET", `/work-packages/${wpAId}/tasks`);
    check("GET work-packages/{id}/tasks (blocked flag)", taskList.status === 200 && taskList.json.every((t: any) => "blocked" in t));

    // === FLOW reads + drag-to-connect (the cycle-409 keystone) ===
    console.log("\n[Flow view — drag-to-connect + cycle-409]");
    const flow0 = await api("GET", `/projects/${projectId}/flow`);
    check("GET flow (nodes/edges/critical_path)", flow0.status === 200 && Array.isArray(flow0.json.nodes) && "task" in flow0.json.edges, `${flow0.json?.nodes?.length} nodes`);

    // drag-connect T1→T2: create-then-add expects 201, edge then present on refetch
    const edge1 = await api("POST", "/task-dependencies", { predecessor_task_id: t1Id, successor_task_id: t2Id });
    check("drag-connect T1→T2 → 201", edge1.status === 201, `status=${edge1.status}`);
    const flow1 = await api("GET", `/projects/${projectId}/flow`);
    const hasEdge = flow1.json.edges.task.some((e: any) => e.predecessor_task_id === t1Id && e.successor_task_id === t2Id);
    check("edge present only AFTER successful create (refetch)", hasEdge);

    // CYCLE: T2→T1 would close a loop → 409, UI shows calm msg + adds NO edge
    const cycle = await api("POST", "/task-dependencies", { predecessor_task_id: t2Id, successor_task_id: t1Id });
    check("CYCLE drag T2→T1 → 409", cycle.status === 409, `status=${cycle.status} code=${cycle.json?.error?.code ?? cycle.json?.code}`);
    const flow2 = await api("GET", `/projects/${projectId}/flow`);
    const phantom = flow2.json.edges.task.some((e: any) => e.predecessor_task_id === t2Id && e.successor_task_id === t1Id);
    check("NO phantom edge after 409 (create-then-add holds)", !phantom);
    check("edge count unchanged after rejected create", flow2.json.edges.task.length === flow1.json.edges.task.length, `${flow2.json.edges.task.length} task edges`);

    // self-dependency → 422 (local reject in UI; backend still guards)
    const self = await api("POST", "/task-dependencies", { predecessor_task_id: t3Id, successor_task_id: t3Id });
    check("self-dependency → 422", self.status === 422, `status=${self.status}`);

    // retry a VALID edge after the cycle rejection (retry works)
    const edge2 = await api("POST", "/task-dependencies", { predecessor_task_id: t2Id, successor_task_id: t3Id });
    check("retry valid edge after cycle → 201", edge2.status === 201);

    // WP-level edge + edge delete
    const wpEdge = await api("POST", "/work-package-dependencies", { predecessor_wp_id: wpAId, successor_wp_id: wpBId });
    check("WP→WP edge → 201", wpEdge.status === 201);
    const delEdge = await api("DELETE", `/task-dependencies/${t1Id}/${t2Id}`);
    check("edge delete → 204", delEdge.status === 204, `status=${delEdge.status}`);
    const flow3 = await api("GET", `/projects/${projectId}/flow`);
    check("deleted edge gone after refetch", !flow3.json.edges.task.some((e: any) => e.predecessor_task_id === t1Id && e.successor_task_id === t2Id));

    // === WP SHEET edits (PATCH) + structural guards (422) ===
    console.log("\n[WP sheet — edits + either/or + time-fixed guards]");
    const patchWp = await api("PATCH", `/work-packages/${wpAId}`, { title: "WP A (edited)", estimate_hours: 5 });
    check("PATCH work-package (title+estimate) → 200", patchWp.status === 200 && patchWp.json.title === "WP A (edited)");
    const patchTask = await api("PATCH", `/tasks/${t1Id}`, { title: "T1 (edited)" });
    check("PATCH task title → 200", patchTask.status === 200 && patchTask.json.title === "T1 (edited)");

    // discriminated unions prevent these in the UI; backend still enforces:
    const bothEst = await api("PATCH", `/tasks/${t1Id}`, { estimate_hours: 2, difficulty: "high" });
    check("both-estimates → 422 (either/or guard)", bothEst.status === 422, `status=${bothEst.status}`);
    const badFixed = await api("PATCH", `/tasks/${t1Id}`, { is_time_fixed: true });
    check("time-fixed w/o date → 422 (pairing guard)", badFixed.status === 422, `status=${badFixed.status}`);
    const goodFixed = await api("PATCH", `/tasks/${t3Id}`, { is_time_fixed: true, fixed_date: "2026-07-01" });
    check("time-fixed WITH date → 200", goodFixed.status === 200 && goodFixed.json.is_time_fixed === true);

    // === TIMELINE drag → proposal (Principle 1 keystone) ===
    console.log("\n[Timeline — cross-day drag = proposal, not PATCH]");
    // confirm a roadmap day first so a replan has a baseline (propose→confirm)
    const propose = await api("POST", "/roadmap/propose", {});
    const firstDay = propose.json?.[0]?.day?.plan_date;
    check("roadmap propose returns days", Array.isArray(propose.json) && !!firstDay, `first day=${firstDay}`);
    if (firstDay) {
      const confirm = await api("POST", `/days/${firstDay}/confirm`);
      check("confirm day", confirm.status === 200 || confirm.status === 201, `status=${confirm.status}`);
    }
    // the drag handler's exact call:
    const replan = await api("POST", "/replan-proposals", {
      trigger: "user_request",
      scope: { project_id: projectId, from_date: firstDay ?? "2026-06-18" },
    });
    check("drag → POST /replan-proposals → 201 pending", replan.status === 201 && replan.json.status === "pending", `status=${replan.status} proposal=${replan.json?.status}`);
    const proposalId = replan.json?.id;
    const detail = await api("GET", `/replan-proposals/${proposalId}`);
    check("ReplanReview reads proposal detail (changes diff)", detail.status === 200 && !!detail.json.changes, `moves=${detail.json?.changes?.moves?.length ?? "?"}`);
    // reject to leave the plan untouched (the walk doesn't approve)
    const reject = await api("POST", `/replan-proposals/${proposalId}/reject`);
    check("reject leaves plan untouched", reject.status === 200 && reject.json.status === "rejected");

    // === DELETE preflight (CORS) for the destructive UI actions ===
    console.log("\n[CORS preflight for DELETE]");
    const pre = await fetch(`${BASE}/tasks/${t1Id}`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "DELETE" },
    });
    check("DELETE preflight → 204 + origin echo", pre.status === 204 && pre.headers.get("access-control-allow-origin") === ORIGIN);

    // cleanup WBS
    const delGoal = await api("DELETE", `/goals/${goalId}`);
    check("goal delete cascade → 204", delGoal.status === 204);
  } finally {
    // Full self-clean so re-runs never pollute the Supabase project:
    //  1) domain rows (workspace + app_user + everything they own) via DB — auth-user
    //     deletion does NOT cascade to our public schema.
    //  2) the auth user itself via the admin API.
    if (domain && env.DIRECT_URL) {
      const db = createDb(env.DIRECT_URL);
      try {
        await teardownWorkspace(db, domain);
        console.log(`\nDomain workspace torn down (workspace + app_user).`);
      } finally {
        await db.destroy();
      }
    }
    if (userId) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      console.log(`Throwaway auth user deleted.`);
    }
  }

  console.log(`\n=== F4 WALK: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("WALK CRASHED:", e);
  process.exit(1);
});

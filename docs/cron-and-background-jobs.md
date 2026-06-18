# Cron & Background Jobs

How and why this platform uses Cron, and what the alternatives are. This is an
explainer for the scheduled background-jobs subsystem (Phase 5); the authoritative
behavioural spec is api-endpoints.md §13 and project-foundation.md §4.4.

## TL;DR

Cron in this repo is exactly **one thing**: a Vercel Cron entry that pings
[`/v1/jobs/tick`](../src/app/v1/jobs/tick/route.ts) every 15 minutes. That single
"heartbeat" exists because the platform runs on Vercel (serverless — there's no
always-on process to run a scheduler), yet the product needs *time-driven* work that
no user request triggers: detecting slipped days, sending morning briefs, firing
nudges, and pruning dead push tokens. The design is deliberately a **coarse global
tick + per-user "am I due?" checks**, not precise schedules, because cron is
UTC-anchored and the users are spread across timezones. Everything downstream is
built to tolerate that coarseness (state-scans, not edge-triggers; an idempotency
ledger). The alternatives are mostly about *who or what pings the endpoint* — and
because the trigger is cleanly decoupled from the work, swapping it out is cheap.

## Why Cron is used

The system has a class of work that has **no user in the loop to trigger it**.
Looking at what [`runTick`](../src/domain/jobs/runner.ts) actually does each tick:

- **Slippage detection** — find confirmed past days that still have unfinished work,
  mark them `slipped`, and surface a recovery proposal
  ([`slippage.ts`](../src/domain/jobs/slippage.ts)).
- **Morning brief** — push a "here's your day" notification at each user's local
  morning time ([`morningBrief.ts`](../src/domain/jobs/morningBrief.ts)).
- **Nudges** — replan-needs-review, streak-at-risk, milestone-approaching
  ([`nudges.ts`](../src/domain/jobs/nudges.ts)).
- **Housekeeping** — prune push tokens unseen for 60+ days
  ([`prune.ts`](../src/domain/jobs/prune.ts)).

These are "things that should happen as wall-clock time passes," not "things that
happen when someone calls an API." Something has to *wake the code up* on a timer.

The deeper reason it's **Vercel Cron specifically** is the locked deployment decision
(Vercel, serverless). In a serverless model there is no daemon, no long-lived
process — a function spins up to serve a request and then dies. So you cannot host
your own scheduler in-process (`setInterval`, a worker thread, a background loop).
You need the *platform* to deliver a periodic invocation, and on Vercel that
mechanism is Cron.

## How it's wired

**The schedule** — [`vercel.json`](../vercel.json) declares a single cron:
`*/15 * * * *` → `/v1/jobs/tick`. That's the *only* scheduled trigger in the whole
system. Every ~15 minutes Vercel makes an HTTP request to that path.

**The endpoint** — [`route.ts`](../src/app/v1/jobs/tick/route.ts) is thin:
authenticate, call `runTick(db)`, return a JSON summary. Vercel Cron issues a `GET`,
so both `GET` and `POST` map to the same handler.

**Authentication — the one non-JWT surface.** Cron has no logged-in user, so it
can't use the JWT tenancy model the rest of the API relies on. Instead Vercel sends
`Authorization: Bearer $CRON_SECRET`, and
[`assertCronSecret`](../src/auth/cron.ts) does a **constant-time** comparison that
**fails closed** — a missing secret, missing header, or wrong value all throw 401.
Critically, the endpoint accepts **no user or workspace id from the caller**; it only
ever acts on users returned by its own server-side scan
([`resolveJobUsers`](../src/domain/jobs/context.ts)), which uses the same
`app_user ⋈ workspace_member` join that request auth uses. This keeps tenancy
airtight even without a JWT.

**Why one coarse tick instead of precise schedules.** Cron is UTC-anchored, and
"local midnight" or "8am local" is a *different instant per timezone*. You'd need a
separate schedule per user/timezone — unmanageable, and not how Vercel Cron works. So
the architecture inverts it: one global tick sweeps **every** user, and each job
decides *per user* whether it's due in that user's local time (invariant #3). For
example, the morning brief checks "is this user's local wall-clock at/past their
configured brief time, and have we not sent today's yet?"

**Why it tolerates an unreliable cron.** Serverless crons fire late, fire twice, or
skip ticks. The design absorbs that by making every job a **state-scan, not an
edge-trigger**:

- *Slippage* finds days strictly before the user's local "today" that still hold a
  planned item; marking them `slipped` removes them from the match set, so a re-run
  finds nothing new.
- *Morning brief / nudges* are gated by the **idempotency ledger**
  ([`dispatch.ts`](../src/domain/jobs/dispatch.ts)): a `claim-then-send` via
  `INSERT … ON CONFLICT DO NOTHING` on `(user, kind, dedupe_key)`. Only the winning
  claim sends; a duplicate tick loses the claim and stays silent (at-most-once — a
  missed nudge is benign, a double nudge is nagging).
- *Prune* is naturally idempotent — a re-run finds nothing past the cutoff.

A late or skipped tick therefore just **catches up** on the next run. The whole point
of the 15-min cadence is to be a forgiving heartbeat rather than a precise alarm
clock.

**Blast-radius control** — each user is processed inside its own `try/catch` in
[`runner.ts`](../src/domain/jobs/runner.ts) so one bad row can't sink the entire
sweep; the tick returns a `TickResult` with counts. And it respects invariant #5:
background jobs never mutate plan items or apply diffs — slippage only flags the day
and creates a *pending proposal* for the user to approve.

## Alternatives to Cron

A key thing to notice first: the trigger is **cleanly decoupled from the work**.
`runTick(db)` is an ordinary function; the route just guards and calls it. So most
"alternatives" only change *who pings the endpoint* — the jobs themselves don't care.
That makes swapping cheap. The options, roughly from "smallest change" to "biggest":

**1. A different external scheduler hitting the same endpoint.** Upstash QStash,
Cloudflare Workers Cron Triggers, Google Cloud Scheduler, AWS EventBridge Scheduler,
GitHub Actions scheduled workflows, or a service like cron-job.org. You keep
`/v1/jobs/tick` and the `CRON_SECRET` guard unchanged. This is the natural move if you
outgrow Vercel Cron's plan limits or want better control over frequency/retries.
**QStash** is notable because it adds delivery guarantees and automatic retries on top
of a plain ping.

**2. Postgres-native scheduling (pg_cron + pg_net).** Supabase supports `pg_cron`
(schedule SQL in the DB) and `pg_net` (make HTTP calls from SQL). You could have the
database itself call `/v1/jobs/tick` on a schedule. This removes the dependency on
Vercel's scheduler but, again, just relocates the trigger. Note: implementing the jobs
*as SQL inside pg_cron* would be a poor fit here — the jobs call into TS domain logic
(`analyzeReplan`, the proposal pipeline, the notifier), and reimplementing that in SQL
would split business logic out of the API, against the project's "our API is the only
writer" stance.

**3. Durable execution / workflow engines** — Inngest, Trigger.dev, Temporal, Defer.
These give you scheduled *and* event-driven functions with **built-in retries,
concurrency control, step/durable state, and observability**. Inngest and Trigger.dev
integrate well with Next.js on Vercel. For a single 15-minute sweep this is overkill,
but it becomes attractive if the jobs grow — fan-out per user, multi-step recovery
flows, retry semantics richer than the current at-most-once ledger. Much of the
hand-rolled idempotency/error-isolation logic would be subsumed by the engine.

**4. A queue with per-user scheduled events** — BullMQ on Redis/Upstash, or SQS +
EventBridge. Instead of "scan all users every 15 minutes," you'd *enqueue* a job like
"send brief at this user's 8am." This flips the model from `O(all users, every tick)`
polling to `O(actual events)`, and gives true per-user timing. Cost: you take on queue
infra (e.g., Redis) and still need something to enqueue the events.

**5. A dedicated long-running worker** — a small always-on Node service (Render,
Railway, Fly.io, a container, EC2) running its own scheduler (node-cron, Agenda,
BullMQ repeatables). This is the classic answer, and it solves timezone scheduling
cleanly with an in-process loop — but it **directly contradicts the locked "deployed
to Vercel / serverless" decision** and means owning a second deployable artifact's
uptime and scaling. Only worth considering if the project abandoned the serverless
constraint.

### What would actually push you off the current setup

The present design is well-matched to the constraints and shouldn't be changed
speculatively. The real pressure point is **scale**: `runTick` loads *every* user and
processes them **serially** in one function invocation. At small scale that's fine; as
the user base grows, that single invocation risks exceeding the serverless
execution-time limit, and the serial loop gets slow. When that day comes, the
lowest-friction evolution is to **keep the endpoint** but move the per-user work to
fan-out — either a durable engine (#3) or a queue (#4) — rather than replacing the
cron itself. And because the trigger is decoupled, the very first cheap step (swap
Vercel Cron for QStash/Cloud Scheduler/pg_cron) touches only
[`vercel.json`](../vercel.json) and the auth surface, not the jobs.

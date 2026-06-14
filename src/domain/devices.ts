/**
 * Device registration for APNs push (api-endpoints.md §3). The `device` table is
 * keyed to the user (no workspace_id column), so list/delete are scoped to
 * `ctx.userId`; a device for another user is invisible → 404 on delete.
 *
 * `registerDevice` upserts by the globally-unique `push_token`. This is the one
 * write NOT scoped by the usual tenancy rule: if a physical device's token is
 * re-registered by a different user (a logout→login on the same handset), the row
 * is REASSIGNED to whoever registers last — pushes follow the current owner of the
 * device, never a stale account. Re-registering by the same user just refreshes
 * `last_seen_at` (no duplicate row).
 */
import type { Kysely } from "kysely";
import type { Database, Device, DevicePlatform } from "../db/types";
import type { AuthContext } from "../auth/context";
import { notFound } from "../lib/errors";

/** GET /me/devices — the caller's registered push devices. */
export async function listDevices(db: Kysely<Database>, ctx: AuthContext): Promise<Device[]> {
  return db
    .selectFrom("device")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .orderBy("created_at", "desc")
    .execute();
}

export interface RegisterDeviceInput {
  platform: DevicePlatform;
  push_token: string;
}

/** POST /me/devices — upsert by unique push_token; refreshes last_seen_at. */
export async function registerDevice(
  db: Kysely<Database>,
  ctx: AuthContext,
  input: RegisterDeviceInput,
  now: Date = new Date(),
): Promise<Device> {
  return db
    .insertInto("device")
    .values({
      user_id: ctx.userId,
      platform: input.platform,
      push_token: input.push_token,
      last_seen_at: now,
    })
    .onConflict((oc) =>
      oc.column("push_token").doUpdateSet({ user_id: ctx.userId, last_seen_at: now }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** DELETE /me/devices/{deviceId} — hard delete, scoped to the caller. */
export async function deleteDevice(
  db: Kysely<Database>,
  ctx: AuthContext,
  deviceId: string,
): Promise<void> {
  const res = await db
    .deleteFrom("device")
    .where("id", "=", deviceId)
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (!res.numDeletedRows || res.numDeletedRows === 0n) {
    throw notFound("Device not found");
  }
}

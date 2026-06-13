/**
 * The push-delivery seam (api §13). Phase 5 builds the scheduling, selection, and
 * idempotency logic; the actual APNs wire-send is deliberately stubbed behind this
 * interface so the testable logic lands now without blocking on push certificates.
 *
 * The real `ApnsNotifier` (device.push_token, platform 'ios') is a later drop-in —
 * nothing above this interface knows or cares how a notification physically ships.
 */

/** A registered push endpoint (one `device` row). */
export interface PushTarget {
  pushToken: string;
  platform: string;
}

export interface NotificationPayload {
  kind: string;
  title: string;
  body: string;
  /** Where the Companion should land when the user taps (e.g. '/morning-brief'). */
  deepLink?: string;
}

export interface Notifier {
  send(target: PushTarget, payload: NotificationPayload): Promise<void>;
}

/**
 * v1 notifier: records the intended send to the log instead of hitting APNs. The
 * dedupe ledger above it has already decided "send this once", so this only ever
 * fires for a genuine, first-time send.
 */
export class LogNotifier implements Notifier {
  async send(target: PushTarget, payload: NotificationPayload): Promise<void> {
    console.log(
      `[notify] ${payload.kind} → ${target.platform}:${target.pushToken.slice(0, 8)}… ` +
        `"${payload.title}"${payload.deepLink ? ` (${payload.deepLink})` : ""}`,
    );
  }
}

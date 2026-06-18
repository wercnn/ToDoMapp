/**
 * Shared chrome for onboarding steps: a heading block, an inline (calm) error
 * banner, and the Back/Continue footer. Keeps every step visually identical and
 * the error-surfacing consistent — each write renders its result/error here
 * before the wizard advances.
 */
import { Button } from "@/components/ui/button";

export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-1.5">
      <h1 className="text-2xl font-black tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm font-semibold text-text-secondary">{subtitle}</p>}
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
      {message}
    </p>
  );
}

export function NavRow({
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  busy,
  primaryType = "button",
}: {
  onBack?: () => void;
  primaryLabel: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  busy?: boolean;
  primaryType?: "button" | "submit";
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          ← Back
        </Button>
      ) : (
        <span />
      )}
      <Button
        type={primaryType}
        onClick={primaryType === "button" ? onPrimary : undefined}
        disabled={primaryDisabled || busy}
      >
        {busy ? "Saving…" : primaryLabel}
      </Button>
    </div>
  );
}

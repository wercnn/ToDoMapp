/**
 * Sheet — a lightweight right-side panel (the day drawer + replan review live in
 * one). Hand-built rather than pulling full shadcn/Radix: a fixed overlay + a
 * slide-in panel, Esc-to-close, scroll-locked body. Tokens only.
 *
 * Deliberately minimal: open/onClose controlled by the parent; the panel is a flex
 * column with a sticky header and a scrollable body so long diffs/day lists scroll
 * without losing the title or footer actions.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = "max-w-md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  /** tailwind max-width utility for the panel. */
  width?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex h-full w-full flex-col border-l border-border bg-bg shadow-xl",
          width,
        )}
      >
        <header className="flex flex-none items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black text-text-primary">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-none rounded-md p-1.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex-none border-t border-border px-5 py-4">{footer}</footer>
        )}
      </aside>
    </div>
  );
}

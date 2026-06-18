/**
 * Theme switching (F5). Dark is the default character; the token layer
 * (styles/tokens.css) remaps the same semantic vars for `.light`. No component
 * knows the theme — switching is purely toggling a class on <html>.
 *
 * Resolution: an explicit user override in localStorage wins; otherwise follow the
 * OS `prefers-color-scheme` (and keep following it live while no override is set).
 */
import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "todomapp-theme";
const mql = () => window.matchMedia("(prefers-color-scheme: light)");

function systemTheme(): Theme {
  return mql().matches ? "light" : "dark";
}

function storedOverride(): Theme | null {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function resolvedTheme(): Theme {
  return storedOverride() ?? systemTheme();
}

function apply(theme: Theme) {
  const el = document.documentElement;
  el.classList.remove("light", "dark");
  el.classList.add(theme);
}

/** Apply at boot and follow the OS while there is no explicit override. */
export function initTheme(): void {
  apply(resolvedTheme());
  mql().addEventListener("change", () => {
    if (!storedOverride()) apply(systemTheme());
  });
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  apply(theme);
}

/** Toggle hook for the TopBar control (persists the override). */
export function useTheme(): [Theme, () => void] {
  const [theme, set] = useState<Theme>(resolvedTheme);
  const toggle = useCallback(() => {
    set((cur) => {
      const next: Theme = cur === "dark" ? "light" : "dark";
      setTheme(next);
      return next;
    });
  }, []);
  return [theme, toggle];
}

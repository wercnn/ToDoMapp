/**
 * App shell — the persistent dashboard frame (web-screens §0): left Sidebar +
 * pinned TopBar, with the active screen rendered in the scrolling main column.
 */
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Shell() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

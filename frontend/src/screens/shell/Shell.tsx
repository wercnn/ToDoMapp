/**
 * App shell — the persistent dashboard frame (web-screens §0): left Sidebar +
 * pinned TopBar, with the active screen rendered in the scrolling main column.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { morningBriefApi } from "@/api";
import { useSession } from "@/auth/session";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MorningBriefSheet } from "./MorningBriefSheet";

export function Shell() {
  const { session } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [briefOpen, setBriefOpen] = useState(false);
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });

  useEffect(() => {
    if (location.pathname === "/morning-brief") setBriefOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    const userId = session?.user.id;
    const today = brief.data?.position.today;
    if (!userId || !today || location.pathname === "/morning-brief") return;
    const key = `morning-brief-opened:${userId}:${today}`;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
    setBriefOpen(true);
  }, [brief.data?.position.today, location.pathname, session?.user.id]);

  function openBrief() {
    setBriefOpen(true);
    navigate("/morning-brief");
  }

  function closeBrief() {
    setBriefOpen(false);
    if (location.pathname === "/morning-brief") navigate("/home", { replace: true });
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <TopBar onOpenBrief={openBrief} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <MorningBriefSheet
        open={briefOpen}
        onClose={closeBrief}
        onOpenRoadmap={() => {
          setBriefOpen(false);
          navigate("/roadmap");
        }}
      />
    </div>
  );
}

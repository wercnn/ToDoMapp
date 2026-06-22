/**
 * Regression for the F5 gap-fix: an achieved milestone must stay ON the path (dated by
 * achieved_date), not drop into the "undatable" footnote once its projected_date goes
 * null. Pure builder, no DB / no render.
 */
import { describe, expect, it } from "vitest";
import type { Roadmap as RoadmapDto } from "@api-types";
import { buildTimeline } from "./timeline";

function roadmap(over: Partial<RoadmapDto> = {}): RoadmapDto {
  return {
    days: [],
    milestones: [],
    position: { today: "2026-06-18", current_streak: 0 },
    ...over,
  };
}

describe("buildTimeline", () => {
  it("anchors an achieved milestone at achieved_date even when projected_date is null", () => {
    const { entries, undated } = buildTimeline(
      roadmap({
        milestones: [
          { id: "ms-1", title: "Beta", achieved: true, achieved_date: "2026-06-15", projected_date: null },
        ],
      }),
    );
    expect(undated).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "milestone", id: "ms-1", date: "2026-06-15", achieved: true });
  });

  it("prefers achieved_date over projected_date when both are present", () => {
    const { entries } = buildTimeline(
      roadmap({
        milestones: [
          { id: "ms-1", title: "Beta", achieved: true, achieved_date: "2026-06-15", projected_date: "2026-07-01" },
        ],
      }),
    );
    expect(entries[0]).toMatchObject({ date: "2026-06-15" });
  });

  it("dates an unachieved milestone by projected_date", () => {
    const { entries, undated } = buildTimeline(
      roadmap({
        milestones: [
          { id: "ms-1", title: "Beta", achieved: false, achieved_date: null, projected_date: "2026-07-01" },
        ],
      }),
    );
    expect(undated).toEqual([]);
    expect(entries[0]).toMatchObject({ date: "2026-07-01", achieved: false });
  });

  it("leaves a milestone undated only when both dates are null", () => {
    const { entries, undated } = buildTimeline(
      roadmap({
        milestones: [
          { id: "ms-1", title: "Beta", achieved: false, achieved_date: null, projected_date: null },
        ],
      }),
    );
    expect(entries).toEqual([]);
    expect(undated).toEqual(["ms-1"]);
  });

  it("sorts a milestone landmark after the day it lands on", () => {
    const day = (date: string): RoadmapDto["days"][number] => ({
      date,
      status: "confirmed",
      is_locked: false,
      items: [],
    });
    const { entries } = buildTimeline(
      roadmap({
        days: [day("2026-06-15"), day("2026-06-16")],
        milestones: [
          { id: "ms-1", title: "Beta", achieved: true, achieved_date: "2026-06-15", projected_date: null },
        ],
      }),
    );
    // day 06-15, then the milestone (closes the day), then day 06-16
    expect(entries.map((e) => (e.kind === "day" ? `day:${e.date}` : `ms:${e.date}`))).toEqual([
      "day:2026-06-15",
      "ms:2026-06-15",
      "day:2026-06-16",
    ]);
  });
});

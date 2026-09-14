import { describe, expect, it } from "vitest";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { mapDepartureTrendPoints, mapRollingHeatmapCells, mapWorkloadSummaryCards } from "./workload-mapper";

describe("工作压力 ViewModel 映射", () => {
  it("首屏只生成九点后、十点后、跨夜和周末四项指标", () => {
    /** 代表性数据对应的核心指标卡 */
    const cards = mapWorkloadSummaryCards(ATTENDANCE_RECORD_MOCKS);

    expect(cards.map((card) => card.label)).toEqual(["21:00 后下班", "22:00 后下班", "跨夜加班", "周末加班"]);
    expect(cards).toHaveLength(4);
  });

  it("下班趋势过滤无打卡日期，并保留周末打卡和待修正下班时间", () => {
    /** 代表性数据对应的下班趋势点 */
    const points = mapDepartureTrendPoints(ATTENDANCE_RECORD_MOCKS);
    /** 跨夜次日的待修正趋势点 */
    const ambiguousPoint = points.find((point) => point.date === "2026-01-23");

    expect(points[0]?.date).toBe("2026-01-22");
    expect(points.some((point) => point.date === "2026-02-12")).toBe(false);
    expect(points.find((point) => point.date === "2026-02-07")?.isWeekend).toBe(true);
    expect(ambiguousPoint).toMatchObject({ endMinute: 1_160, endLabel: "19:20" });
  });

  it("滚动热力图只保留近 30 天内至少存在一次打卡的日期", () => {
    /** 截至二月底的滚动 30 天热力单元格 */
    const cells = mapRollingHeatmapCells(ATTENDANCE_RECORD_MOCKS, "2026-02-28");
    /** 周末加班样本对应的热力单元格 */
    const weekendCell = cells.find((cell) => cell.date === "2026-02-07");

    expect(cells).toHaveLength(5);
    expect(cells[0]?.date).toBe("2026-02-03");
    expect(cells[4]?.date).toBe("2026-02-07");
    expect(cells.some((cell) => cell.date === "2026-02-12")).toBe(false);
    expect(weekendCell).toMatchObject({ isWeekend: true, tone: "before-nine" });
  });
});

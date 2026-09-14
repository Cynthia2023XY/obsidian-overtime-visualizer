import { describe, expect, it } from "vitest";
import { calculateAttendanceSummary } from "../analytics/summary";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { mapSummaryCards, mapTimelinePoints } from "./dashboard-mapper";

describe("仪表盘 ViewModel 映射", () => {
  it("排除整天请假和跨夜次日起始歧义数据", () => {
    /** 代表性 mock 的数值聚合结果 */
    const summary = calculateAttendanceSummary(ATTENDANCE_RECORD_MOCKS);
    expect(summary.validAttendanceDays).toBe(6);
    expect(summary.excludedDays).toBe(2);
    expect(summary.overnightDays).toBe(1);
    expect(summary.ambiguousDays).toBe(1);
  });

  it("将跨夜记录保留在连续时间轴上", () => {
    /** 代表性 mock 对应的日级时间轴数据 */
    const timelinePoints = mapTimelinePoints(ATTENDANCE_RECORD_MOCKS);
    /** 时间轴中的跨夜数据点 */
    const overnightPoint = timelinePoints.find((point) => point.modifier === "overnight");

    expect(timelinePoints).toHaveLength(6);
    expect(overnightPoint).toMatchObject({ date: "01-22", startMinute: 540, endMinute: 1_441, presenceMinutes: 901, endLabel: "次日 00:01" });
  });

  it("为指标卡显示样本数和排除数", () => {
    /** 代表性 mock 对应的指标卡 */
    const cards = mapSummaryCards(ATTENDANCE_RECORD_MOCKS);
    expect(cards[0]).toMatchObject({ label: "有效出勤", value: "6 天", detail: "排除 2 条无效或待修正数据" });
    expect(cards[1]?.detail).toBe("样本数 n=6");
  });
});

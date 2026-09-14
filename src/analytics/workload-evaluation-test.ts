import { describe, expect, it } from "vitest";
import type { AttendanceRecord } from "../types/attendance";
import { calculateWorkloadMetrics, evaluateRollingThirtyDays } from "./workload-evaluation";

/** 创建只包含评价逻辑所需字段的完整考勤记录 */
function createRecord(
  date: string,
  endMinute: number,
  weekday = 1,
  overnightState: AttendanceRecord["overnightState"] = "none",
): AttendanceRecord {
  return {
    date,
    weekday,
    dayType: weekday >= 6 ? "rest-day" : "workday",
    startMinute: 9 * 60,
    endMinute,
    attendanceState: "complete",
    overnightState,
    isReleaseDay: false,
    leaveReasons: [],
    warnings: [],
    source: {
      attendanceDay: date.replace(/-/g, "."),
      attendanceStartTime: "09:00:00",
      attendanceEndTime: null,
      weekDay: null,
      workDayType: null,
      applyReason: null,
      attendanceStatus: null,
    },
    manuallyEdited: false,
  };
}

describe("加班压力评价", () => {
  it("严格使用九点后和十点后边界，并以有效出勤作为比例分母", () => {
    /** 包含边界、周末和跨夜的有效记录 */
    const records = [
      createRecord("2026-03-01", 21 * 60),
      createRecord("2026-03-02", 21 * 60 + 1),
      createRecord("2026-03-03", 22 * 60),
      createRecord("2026-03-07", 22 * 60 + 1, 6, "linked"),
    ];
    /** 核心工作压力统计 */
    const metrics = calculateWorkloadMetrics(records);

    expect(metrics).toMatchObject({
      validAttendanceDays: 4,
      afterNineDays: 3,
      afterNineRatio: 75,
      afterTenDays: 1,
      afterTenRatio: 25,
      overnightDays: 1,
      overnightRatio: 25,
      weekendWorkDays: 1,
    });
  });

  it("只要下班时间可信便纳入统计，不因上班时间待修正而丢失", () => {
    /** 有下班时间但上班时间仍待修正的记录 */
    const ambiguousRecord: AttendanceRecord = {
      ...createRecord("2026-03-05", 22 * 60 + 10),
      startMinute: null,
      attendanceState: "ambiguous-start",
    };
    /** 只关注下班信息得到的核心指标 */
    const metrics = calculateWorkloadMetrics([ambiguousRecord]);

    expect(metrics.validAttendanceDays).toBe(1);
    expect(metrics.afterTenDays).toBe(1);
  });

  it("按无重叠边界生成九点后和十点后压力等级", () => {
    /** 近 30 天内连续 16 天均在十点后下班的高压样本 */
    const records = Array.from({ length: 16 }, (_value, index) => createRecord(`2026-03-${String(index + 1).padStart(2, "0")}`, 22 * 60 + 1));
    /** 截至三月底的滚动压力评价 */
    const evaluation = evaluateRollingThirtyDays(records, new Date(2026, 2, 30));

    expect(evaluation.rangeStart).toBe("2026-03-01");
    expect(evaluation.afterNine.level).toBe("painful");
    expect(evaluation.afterTen.level).toBe("painful");
    expect(evaluation.overallLabel).toBe("痛苦");
  });

  it("比较当前和前一 30 天中位下班时间并识别变晚", () => {
    /** 前一窗口和当前窗口各三个稳定样本 */
    const records = [
      createRecord("2026-02-10", 21 * 60),
      createRecord("2026-02-11", 21 * 60 + 10),
      createRecord("2026-02-12", 21 * 60 + 20),
      createRecord("2026-03-10", 22 * 60),
      createRecord("2026-03-11", 22 * 60 + 10),
      createRecord("2026-03-12", 22 * 60 + 20),
    ];
    /** 截至三月底的滚动压力评价 */
    const evaluation = evaluateRollingThirtyDays(records, new Date(2026, 2, 30));

    expect(evaluation.comparison).toMatchObject({
      differenceMinute: 60,
      direction: "later",
    });
  });

  it("当前窗口没有有效记录时返回数据不足而不是轻松", () => {
    /** 没有任何近 30 天考勤的评价 */
    const evaluation = evaluateRollingThirtyDays([], new Date(2026, 2, 30));

    expect(evaluation.overallLevel).toBe("insufficient");
    expect(evaluation.metrics.afterNineRatio).toBeNull();
    expect(evaluation.comparison.direction).toBe("insufficient");
  });
});

import { describe, expect, it } from "vitest";
import type { AttendanceRecord } from "../types/attendance";
import { calculateMonthlyPressureTrend, calculateWorkloadMetrics, evaluateRollingThirtyDays } from "./workload-evaluation";

/** 创建只包含评价逻辑所需字段的完整考勤记录 */
function createRecord(
  date: string,
  endMinute: number,
  weekday = 1,
  overnightState: AttendanceRecord["overnightState"] = "none",
  isReleaseDay = false,
): AttendanceRecord {
  return {
    date,
    weekday,
    dayType: weekday >= 6 ? "rest-day" : "workday",
    startMinute: 9 * 60,
    endMinute,
    attendanceState: "complete",
    overnightState,
    isReleaseDay,
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

/** 创建指定数量且日期连续的当月考勤记录 */
function createMonthlyRecords(count: number, resolveEndMinute: (index: number) => number): AttendanceRecord[] {
  return Array.from({ length: count }, (_value, index) => createRecord(`2026-03-${String(index + 1).padStart(2, "0")}`, resolveEndMinute(index)));
}

describe("加班压力评价", () => {
  it("将六个起始边界归入互斥时间档位", () => {
    /** 包含正常下班与六个档位起始边界的记录 */
    const records = [
      createRecord("2026-03-01", 20 * 60 + 59),
      createRecord("2026-03-02", 21 * 60),
      createRecord("2026-03-03", 21 * 60 + 30),
      createRecord("2026-03-04", 22 * 60),
      createRecord("2026-03-05", 23 * 60),
      createRecord("2026-03-06", 23 * 60 + 30),
      createRecord("2026-03-07", 24 * 60, 6, "linked"),
    ];
    /** 六档时间边界对应的压力统计 */
    const metrics = calculateWorkloadMetrics(records);

    expect(metrics.departureBands.map((band) => band.count)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(metrics).toMatchObject({
      validAttendanceDays: 7,
      averageDepartureMinute: 1_320,
      averageDepartureSampleDays: 6,
      afterNineDays: 6,
      afterTenDays: 4,
      afterElevenDays: 3,
      afterElevenThirtyDays: 2,
      overnightDays: 1,
      weekendWorkDays: 1,
      rawPressureScore: 27,
      standardizedPressureScore: 77.1,
    });
    expect(metrics.pressureContributions.find((contribution) => contribution.id === "weekend")?.score).toBe(6);
  });

  it("平均下班时间只统计周一至周四", () => {
    /** 包含周内、周五和周末下班时间的样本 */
    const records = [
      createRecord("2026-03-02", 21 * 60, 1),
      createRecord("2026-03-03", 22 * 60, 2),
      createRecord("2026-03-06", 18 * 60, 5),
      createRecord("2026-03-07", 24 * 60, 6, "linked"),
    ];
    /** 应当排除周五和周末的平均下班指标 */
    const metrics = calculateWorkloadMetrics(records);

    expect(metrics.averageDepartureMinute).toBe(21 * 60 + 30);
    expect(metrics.averageDepartureSampleDays).toBe(2);
    expect(metrics.validAttendanceDays).toBe(4);
  });

  it("周末加班每天固定六分且不叠加晚归时段分", () => {
    /** 同为周末但下班时间差异很大的两条有效记录 */
    const records = [
      createRecord("2026-03-07", 18 * 60, 6),
      createRecord("2026-03-08", 24 * 60 + 30, 7, "linked"),
    ];
    /** 使用周末固定计分规则得到的压力指标 */
    const metrics = calculateWorkloadMetrics(records);

    expect(metrics.weekendWorkDays).toBe(2);
    expect(metrics.rawPressureScore).toBe(12);
    expect(metrics.standardizedPressureScore).toBe(120);
    expect(metrics.pressureContributions.find((contribution) => contribution.id === "overnight")?.score).toBe(0);
    expect(metrics.pressureContributions.find((contribution) => contribution.id === "weekend")?.score).toBe(12);
  });

  it("按自然月生成统一口径的压力指数走势", () => {
    /** 横跨两个自然月的压力指数样本 */
    const records = [
      createRecord("2026-02-27", 21 * 60),
      createRecord("2026-02-28", 20 * 60),
      createRecord("2026-03-01", 22 * 60),
      createRecord("2026-03-02", 22 * 60),
    ];
    /** 按月聚合后的压力指数趋势 */
    const trend = calculateMonthlyPressureTrend(records);

    expect(trend).toEqual([
      { month: "2026-02", label: "2月", score: 10, validAttendanceDays: 2 },
      { month: "2026-03", label: "3月", score: 80, validAttendanceDays: 2 },
    ]);
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
    expect(metrics.departureBands[2]?.count).toBe(1);
  });

  it("按有效出勤日折算为二十天压力分", () => {
    /** 五天在 21:00 下班且其余十五天在 21:00 前下班的样本 */
    const records = createMonthlyRecords(20, (index) => index < 5 ? 21 * 60 : 20 * 60);
    /** 截至三月底的滚动压力评价 */
    const evaluation = evaluateRollingThirtyDays(records, new Date(2026, 2, 30));

    expect(evaluation.scoreEvaluation).toMatchObject({ score: 5, level: "relaxed" });
    expect(evaluation.overallLabel).toBe("轻松");
  });

  it("触发极晚下班红线时将疲惫积分强制升级为痛苦", () => {
    /** 两天 23:30 下班且其余日期正常下班的样本 */
    const records = createMonthlyRecords(20, (index) => index < 2 ? 23 * 60 + 30 : 20 * 60);
    /** 截至三月底的滚动压力评价 */
    const evaluation = evaluateRollingThirtyDays(records, new Date(2026, 2, 30));

    expect(evaluation.scoreEvaluation).toMatchObject({ score: 16, level: "tired" });
    expect(evaluation.redLineReasons).toContain("23:30 后下班达到 2 天");
    expect(evaluation.overallLevel).toBe("painful");
  });

  it("按 22:00 后记录中的上线日占比进行归因", () => {
    /** 四天 22:00 后下班且其中三天为上线日的样本 */
    const records = [
      createRecord("2026-03-01", 22 * 60, 1, "none", true),
      createRecord("2026-03-02", 22 * 60 + 10, 2, "none", true),
      createRecord("2026-03-03", 23 * 60, 3, "none", true),
      createRecord("2026-03-04", 22 * 60 + 20),
    ];
    /** 上线日高强度加班归因结果 */
    const attribution = evaluateRollingThirtyDays(records, new Date(2026, 2, 30)).releaseAttribution;

    expect(attribution).toMatchObject({ releaseAfterTenDays: 3, afterTenDays: 4, releaseShare: 75, type: "release-centered" });
  });

  it("比较当前和前一 30 天标准化压力分并识别上升", () => {
    /** 前一窗口与当前窗口各三个稳定样本 */
    const records = [
      createRecord("2026-02-10", 21 * 60),
      createRecord("2026-02-11", 21 * 60),
      createRecord("2026-02-12", 21 * 60),
      createRecord("2026-03-10", 22 * 60),
      createRecord("2026-03-11", 22 * 60),
      createRecord("2026-03-12", 22 * 60),
    ];
    /** 截至三月底的滚动压力评价 */
    const evaluation = evaluateRollingThirtyDays(records, new Date(2026, 2, 30));

    expect(evaluation.comparison).toMatchObject({
      currentScore: 80,
      previousScore: 20,
      differenceScore: 60,
      changePercent: 300,
      direction: "worsened",
    });
  });

  it("当前窗口没有有效记录时返回数据不足而不是轻松", () => {
    /** 没有任何近 30 天考勤的评价 */
    const evaluation = evaluateRollingThirtyDays([], new Date(2026, 2, 30));

    expect(evaluation.overallLevel).toBe("insufficient");
    expect(evaluation.scoreEvaluation.score).toBeNull();
    expect(evaluation.metrics.departureBands.every((band) => band.ratio === null)).toBe(true);
    expect(evaluation.comparison.direction).toBe("insufficient");
  });
});

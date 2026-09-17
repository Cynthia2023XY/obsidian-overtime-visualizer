import { describe, expect, it } from "vitest";
import type { AttendanceRecord } from "../types/attendance";
import type { ReliefEntry } from "../types/storage";
import { calculateDailyPressureLedger, calculateReliefScore, summarizePressureLedger } from "./pressure-ledger";

/** 创建可用于压力账本测试的最小考勤记录 */
function createRecord(date: string, weekday: number, endMinute: number): AttendanceRecord {
  return {
    date,
    weekday,
    dayType: weekday >= 6 ? "rest-day" : "workday",
    startMinute: 9 * 60,
    endMinute,
    overnightState: "none",
    attendanceState: "complete",
    isReleaseDay: false,
    leaveReasons: [],
    warnings: [],
    source: {
      attendanceDay: date,
      attendanceStartTime: "09:00",
      attendanceEndTime: "21:00",
      weekDay: null,
      workDayType: null,
      applyReason: null,
      attendanceStatus: null,
    },
    manuallyEdited: false,
  };
}

/** 创建指定日期和类型的解压行为明细 */
function createReliefEntry(id: string, date: string, type: ReliefEntry["type"], durationMinutes: number): ReliefEntry {
  return { id, date, type, durationMinutes, createdAt: Number(id.replace(/\D/g, "")) || 1 };
}

describe("每日压力账本", () => {
  it("阅读每半小时计零点五分，散步和骑车按固定时长计分", () => {
    /** 包含阅读、散步和骑车的当日解压样本 */
    const entries = [
      createReliefEntry("1", "2026-09-16", "sanlian", 30),
      createReliefEntry("2", "2026-09-16", "scientific-american", 30),
      createReliefEntry("3", "2026-09-16", "walk", 15),
      createReliefEntry("4", "2026-09-16", "cycling", 60),
    ];
    expect(calculateReliefScore(entries)).toBe(3.2);
  });

  it("解压只能抵扣当天且当日最终分不低于零", () => {
    /** 九点后下班产生一分压力的考勤 */
    const record = createRecord("2026-09-15", 2, 21 * 60 + 10);
    /** 当天理论可产生两分的骑车记录 */
    const entries = [createReliefEntry("1", record.date, "cycling", 60)];
    expect(calculateDailyPressureLedger(record.date, record, entries, "2026-09-16")).toMatchObject({ overtimeScore: 1, reliefScore: 2, appliedReliefScore: 1, finalScore: 0, status: "settled" });
  });

  it("当日即使已有下班数据也保持待结算", () => {
    /** 今日已出现下班打卡的样本 */
    const record = createRecord("2026-09-16", 3, 22 * 60);
    expect(calculateDailyPressureLedger(record.date, record, [], "2026-09-16")).toMatchObject({ status: "pending", finalScore: 0 });
  });

  it("周期汇总先逐日封顶再求和，不允许跨日抵扣", () => {
    /** 两个一分加班日的考勤样本 */
    const records = [createRecord("2026-09-14", 1, 21 * 60 + 10), createRecord("2026-09-15", 2, 21 * 60 + 10)];
    /** 全部发生在第一天的两分解压行为 */
    const entries = [createReliefEntry("1", "2026-09-14", "cycling", 60)];
    expect(summarizePressureLedger(records, entries, "2026-09-16")).toMatchObject({ overtimeScore: 2, reliefScore: 2, appliedReliefScore: 1, finalScore: 1 });
  });
});

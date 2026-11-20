import { describe, expect, it } from "vitest";
import {
  buildCompTimeLedgerViews,
  calculateCompTimeOvertime,
  calculateCompTimeReport,
  calculateExtendedExpiryDate,
  calculateInitialExpiryDate,
  createEmptyCompTimeData,
  getAttendanceCycle,
  getCurrentCycleCandidates,
  summarizeCompTime,
} from "./comp-time";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import type { AttendanceRecord } from "../types/attendance";

/** 构造用于调休测试的最小考勤记录 */
function makeRecord(
  date: string,
  startMinute: number | null,
  endMinute: number | null,
  dayType: AttendanceRecord["dayType"] = "holiday",
  overnightState: AttendanceRecord["overnightState"] = "none",
): AttendanceRecord {
  return {
    ...ATTENDANCE_RECORD_MOCKS[0]!,
    date,
    startMinute,
    endMinute,
    dayType,
    overnightState,
    attendanceState: startMinute !== null && endMinute !== null ? "complete" : "non-working-day",
    warnings: [],
    leaveReasons: [],
  };
}

describe("调休时长与规则计算", () => {
  it("不足0.5小时不计，0.5至1小时之间按0.5小时计算，且扣除12:00-13:00与18:00-19:00", () => {
    expect(calculateCompTimeOvertime(9 * 60, 9 * 60 + 29, false).calculatedHours).toBe(0);
    expect(calculateCompTimeOvertime(9 * 60, 9 * 60 + 30, false).calculatedHours).toBe(0.5);
    expect(calculateCompTimeOvertime(9 * 60, 9 * 60 + 59, false).calculatedHours).toBe(0.5);
    expect(calculateCompTimeOvertime(9 * 60, 10 * 60, false).calculatedHours).toBe(1);

    // 09:00-20:00 共11小时，扣除12:00-13:00和18:00-19:00共2小时，净计9小时
    const fullDay = calculateCompTimeOvertime(9 * 60, 20 * 60, false);
    expect(fullDay.rawNetMinutes).toBe(9 * 60);
    expect(fullDay.calculatedHours).toBe(9);

    // 11:30-13:30 跨越午休1小时，净计1小时
    expect(calculateCompTimeOvertime(11 * 60 + 30, 13 * 60 + 30, false).calculatedHours).toBe(1);
    // 17:40-19:20 跨越晚饭1小时，仅余40分钟，按0.5小时计算
    expect(calculateCompTimeOvertime(17 * 60 + 40, 19 * 60 + 20, false).calculatedHours).toBe(0.5);
  });

  it("跨夜当天最多计算4个小时，未超过4小时按实际净时长计算", () => {
    // 10:00 至次日 02:00（1560分），扣除2小时吃饭后为14小时，跨夜封顶4小时
    const capped = calculateCompTimeOvertime(10 * 60, 26 * 60, true);
    expect(capped.uncappedHours).toBe(14);
    expect(capped.calculatedHours).toBe(4);
    expect(capped.cappedByOvernight).toBe(true);

    // 21:00 至次日 00:30（1470分），净计3.5小时，未超4小时不封顶
    const shortOvernight = calculateCompTimeOvertime(21 * 60, 24 * 60 + 30, true);
    expect(shortOvernight.calculatedHours).toBe(3.5);
    expect(shortOvernight.cappedByOvernight).toBe(false);
  });

  it("按加班所在月起3个月内月底计算到期日，并支持延期一次延3个月", () => {
    expect(calculateInitialExpiryDate("2026-07-13")).toBe("2026-09-30");
    expect(calculateExtendedExpiryDate("2026-09-30")).toBe("2026-12-31");

    // 跨年与闰年2月边界
    expect(calculateInitialExpiryDate("2026-11-20")).toBe("2027-01-31");
    expect(calculateExtendedExpiryDate("2027-01-31")).toBe("2027-04-30");
    expect(calculateInitialExpiryDate("2023-12-10")).toBe("2024-02-29");
    expect(calculateInitialExpiryDate("2025-12-10")).toBe("2026-02-28");
  });

  it("每月21日关账，仅自动带出当前周期法定节假日或特殊日期，过往未提报自动清空，且次日起可提报", () => {
    expect(getAttendanceCycle("2026-11-20")).toEqual({
      key: "2026-11",
      startDate: "2026-10-22",
      endDate: "2026-11-21",
      closeDate: "2026-11-21",
    });
    expect(getAttendanceCycle("2026-11-22")).toEqual({
      key: "2026-12",
      startDate: "2026-11-22",
      endDate: "2026-12-21",
      closeDate: "2026-12-21",
    });

    const data = createEmptyCompTimeData();
    data.specialDates.push({ date: "2026-11-15", note: "双十一保障日" });

    const records = [
      // 过往周期的节假日（未提报）-> 自动清空，不带出
      makeRecord("2026-10-01", 9 * 60, 18 * 60, "holiday"),
      // 当前周期普通工作日 09:00-18:45（扣除18:00-19:00晚饭后净加班为0）-> 不带出
      makeRecord("2026-11-17", 9 * 60, 18 * 60 + 45, "workday"),
      // 当前周期日常工作日加班 09:00-21:40（19:00起算共2小时40分 -> 2.5小时）-> 带出
      makeRecord("2026-11-18", 9 * 60, 21 * 60 + 40, "workday"),
      // 当前周期普通休息日 09:00-18:00（扣除12:00-13:00共8小时）-> 带出
      makeRecord("2026-11-14", 9 * 60, 18 * 60, "rest-day"),
      // 当前周期特殊日期 -> 带出且已过当天，可提报
      makeRecord("2026-11-15", 9 * 60, 17 * 60, "rest-day"),
      // 当前周期当天节假日 -> 带出但不可当天提报
      makeRecord("2026-11-20", 9 * 60, 17 * 60, "holiday"),
    ];

    const candidates = getCurrentCycleCandidates(records, data, "2026-11-20");
    expect(candidates.map((item) => item.date)).toEqual(["2026-11-20", "2026-11-18", "2026-11-15", "2026-11-14"]);

    const todayCandidate = candidates[0]!;
    expect(todayCandidate.sourceType).toBe("holiday");
    expect(todayCandidate.canSubmit).toBe(false);
    expect(todayCandidate.adjustedHours).toBe(7);

    const workdayCandidate = candidates[1]!;
    expect(workdayCandidate.sourceType).toBe("workday");
    expect(workdayCandidate.canSubmit).toBe(true);
    expect(workdayCandidate.adjustedHours).toBe(2.5);

    const specialCandidate = candidates[2]!;
    expect(specialCandidate.sourceType).toBe("special-date");
    expect(specialCandidate.specialNote).toBe("双十一保障日");
    expect(specialCandidate.canSubmit).toBe(true);
    expect(specialCandidate.adjustedHours).toBe(7);

    const restCandidate = candidates[3]!;
    expect(restCandidate.sourceType).toBe("rest-day");
    expect(restCandidate.adjustedHours).toBe(8);
  });

  it("正确计算台账状态（可用、即将到期、已用完、已过期）与顶部汇总指标", () => {
    const data = createEmptyCompTimeData();
    data.entries = {
      a: {
        id: "a",
        date: "2026-10-01",
        sourceType: "holiday",
        hours: 8,
        initialExpiresAt: "2026-12-31",
        expiresAt: "2026-12-31",
        extended: false,
        usages: [{ id: "u1", usedHours: 2, usedDate: "2026-10-15", note: "", createdAt: 1 }],
        submittedAt: 1,
        note: "",
      },
      b: {
        id: "b",
        date: "2026-09-10",
        sourceType: "holiday",
        hours: 4,
        initialExpiresAt: "2026-11-30",
        expiresAt: "2026-11-30",
        extended: false,
        usages: [],
        submittedAt: 2,
        note: "",
      },
      c: {
        id: "c",
        date: "2026-07-13",
        sourceType: "holiday",
        hours: 5,
        initialExpiresAt: "2026-09-30",
        expiresAt: "2026-09-30",
        extended: false,
        usages: [{ id: "u2", usedHours: 1, usedDate: "2026-08-01", note: "", createdAt: 2 }],
        submittedAt: 3,
        note: "",
      },
    };

    const views = buildCompTimeLedgerViews(data, "2026-11-20");
    const byId = Object.fromEntries(views.map((view) => [view.entry.id, view]));
    expect(byId.a!.status).toBe("available");
    expect(byId.a!.remainingHours).toBe(6);
    expect(byId.b!.status).toBe("expiring-soon");
    expect(byId.b!.canExtend).toBe(true);
    expect(byId.c!.status).toBe("expired");
    expect(byId.c!.canExtend).toBe(false);

    const summary = summarizeCompTime([], views);
    expect(summary.availableHours).toBe(10);
    expect(summary.expiringSoonHours).toBe(4);
    expect(summary.usedHours).toBe(3);
    expect(summary.expiredHours).toBe(4);
  });

  it("支持按任意起止日期区间统计可提报调休明细与总时长，并优先使用导入校准值", () => {
    const data = createEmptyCompTimeData();
    data.draftHourOverrides["2026-11-18"] = 5;

    const records = [
      makeRecord("2026-10-15", 9 * 60, 21 * 60, "workday"),
      makeRecord("2026-11-11", 9 * 60, 20 * 60, "holiday"),
      makeRecord("2026-11-18", 9 * 60, 21 * 60, "workday"),
    ];

    const report = calculateCompTimeReport(records, data, "2026-11-01", "2026-11-20");
    expect(report.rows.map((row) => row.date)).toEqual(["2026-11-18", "2026-11-11"]);
    expect(report.rows[0]!.reportableHours).toBe(5);
    expect(report.rows[0]!.fromImport).toBe(true);
    expect(report.rows[1]!.reportableHours).toBe(9);
    expect(report.rows[1]!.referenceExpiresAt).toBe("2027-01-31");
    expect(report.totalHours).toBe(14);
  });
});

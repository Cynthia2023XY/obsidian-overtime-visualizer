import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { normalizeAttendanceRecord } from "./normalize-record";

describe("考勤记录清洗", () => {
  it("只保留白名单字段并按秒四舍五入", () => {
    /** 包含个人敏感字段的原始 HR 记录 */
    const rawRecord = {
      attendanceDay: "2026.02.05",
      attendanceStartTime: "09:26:28",
      attendanceEndTime: "21:59:45",
      weekDay: "星期四",
      workDayType: "工作日",
      applyReason: "正常",
      attendanceStatus: "正常",
      realName: "不应保留",
      attendanceStartLocation: "不应保留",
    };
    /** 原始 HR 记录的脱敏规范化结果 */
    const result = normalizeAttendanceRecord(rawRecord, DEFAULT_SETTINGS);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.record).toMatchObject({ date: "2026-02-05", weekday: 4, startMinute: 566, endMinute: 1_320, attendanceState: "complete", isReleaseDay: true });
    expect(JSON.stringify(result.record)).not.toContain("realName");
    expect(JSON.stringify(result.record)).not.toContain("不应保留");
  });

  it("区分休息日、整天调休和部分病假", () => {
    /** 无打卡休息日的规范化结果 */
    const restDay = normalizeAttendanceRecord({ attendanceDay: "2026.02.08", weekDay: "星期日", workDayType: "休息日", applyReason: "休息日" }, DEFAULT_SETTINGS);
    /** 无打卡调休工作日的规范化结果 */
    const fullLeave = normalizeAttendanceRecord({ attendanceDay: "2026.02.12", weekDay: "星期四", workDayType: "工作日", applyReason: "调休假" }, DEFAULT_SETTINGS);
    /** 带打卡病假工作日的规范化结果 */
    const partialLeave = normalizeAttendanceRecord({ attendanceDay: "2026.01.14", attendanceStartTime: "10:56:37", attendanceEndTime: "21:07:05", weekDay: "星期三", workDayType: "工作日", applyReason: "正常,全薪病假" }, DEFAULT_SETTINGS);

    expect(restDay.success && restDay.record.attendanceState).toBe("non-working-day");
    expect(fullLeave.success && fullLeave.record.attendanceState).toBe("full-leave");
    expect(partialLeave.success && partialLeave.record.attendanceState).toBe("partial-leave");
    expect(partialLeave.success && partialLeave.record.leaveReasons).toEqual(["全薪病假"]);
  });

  it("拒绝非法日期和非法时间", () => {
    expect(normalizeAttendanceRecord({ attendanceDay: "2026.02.30" }, DEFAULT_SETTINGS).success).toBe(false);
    expect(normalizeAttendanceRecord({ attendanceDay: "2026.02.05", attendanceStartTime: "25:00:00" }, DEFAULT_SETTINGS).success).toBe(false);
  });
});

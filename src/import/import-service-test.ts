import { describe, expect, it } from "vitest";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { DEFAULT_SETTINGS } from "../settings";
import { prepareAttendanceImport } from "./import-service";

describe("考勤导入预览", () => {
  it("关联跨夜结束并排除次日起始歧义", () => {
    /** 原始跨夜日和次日考勤对象 */
    const rawItems = [
      { attendanceDay: "2026.01.22", attendanceStartTime: "08:58:27", attendanceEndTime: "23:55:38", weekDay: "星期四", workDayType: "工作日", applyReason: "跨夜加班" },
      { attendanceDay: "2026.01.23", attendanceStartTime: "00:01:19", attendanceEndTime: "19:20:57", weekDay: "星期五", workDayType: "工作日", applyReason: "正常" },
    ];
    /** 跨夜原始数据的导入预览 */
    const preview = prepareAttendanceImport(rawItems, [], DEFAULT_SETTINGS);
    /** 关联后的跨夜当日记录 */
    const overnightRecord = preview.recordsToWrite.find((record) => record.date === "2026-01-22");
    /** 关联后的跨夜次日记录 */
    const nextRecord = preview.recordsToWrite.find((record) => record.date === "2026-01-23");

    expect(overnightRecord).toMatchObject({ endMinute: 1_441, overnightState: "linked" });
    expect(nextRecord?.attendanceState).toBe("ambiguous-start");
    expect(nextRecord?.warnings[0]).toContain("待手工修正");
  });

  it("拒绝本批重复日期并保留已有人工修改", () => {
    /** 用于验证重复和冲突的单日原始数据 */
    const rawRecord = { attendanceDay: "2026.02.03", attendanceStartTime: "10:27:02", attendanceEndTime: "22:31:28", weekDay: "星期二", workDayType: "工作日", applyReason: "正常" };
    /** 带人工修改标记的已有记录 */
    const manuallyEditedRecord = { ...ATTENDANCE_RECORD_MOCKS[0]!, manuallyEdited: true };
    /** 包含重复日期和人工修改冲突的预览 */
    const preview = prepareAttendanceImport([rawRecord, rawRecord], [manuallyEditedRecord], DEFAULT_SETTINGS);

    expect(preview.skipCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.recordsToWrite).toHaveLength(0);
  });

  it("分批导入跨夜次日时同步更新已有跨夜当日", () => {
    /** 已存在但尚未找到次日的跨夜当日记录 */
    const existingOvernightRecord = {
      ...ATTENDANCE_RECORD_MOCKS[6]!,
      endMinute: 1_436,
      overnightState: "confirmed" as const,
    };
    /** 后续单独导入的跨夜次日原始记录 */
    const nextDayRawRecord = { attendanceDay: "2026.01.23", attendanceStartTime: "00:01:19", attendanceEndTime: "19:20:57", weekDay: "星期五", workDayType: "工作日", applyReason: "正常" };
    /** 分批导入跨夜次日时生成的联动预览 */
    const preview = prepareAttendanceImport([nextDayRawRecord], [existingOvernightRecord], DEFAULT_SETTINGS);
    /** 预览中对已有跨夜当日的联动更新 */
    const relatedUpdate = preview.recordsToWrite.find((record) => record.date === "2026-01-22");

    expect(preview.createCount).toBe(1);
    expect(preview.updateCount).toBe(1);
    expect(relatedUpdate).toMatchObject({ endMinute: 1_441, overnightState: "linked" });
  });
});

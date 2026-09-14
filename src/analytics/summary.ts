import type { AttendanceRecord, ValidAttendanceRecord } from "../types/attendance";
import type { AttendanceSummary } from "../types/view-model";

/** 默认参与在岗时长计算的最早上班时刻 */
export const DEFAULT_START_FLOOR_MINUTE = 9 * 60;
/** 默认用于比较下班早晚的 21:00 基准 */
export const DEFAULT_END_BENCHMARK_MINUTE = 21 * 60;

/** 判断考勤记录是否可以进入时长与下班时间统计 */
export function isValidAttendanceRecord(record: AttendanceRecord): record is ValidAttendanceRecord {
  return record.attendanceState === "complete"
    && record.startMinute !== null
    && record.endMinute !== null
    && record.endMinute >= record.startMinute;
}

/** 计算单条有效考勤记录的在岗分钟数 */
export function calculatePresenceMinutes(
  record: AttendanceRecord,
  startFloorMinute = DEFAULT_START_FLOOR_MINUTE,
): number | null {
  if (!isValidAttendanceRecord(record)) return null;
  /** 经过早到口径修正后的计算起点 */
  const effectiveStartMinute = Math.max(record.startMinute, startFloorMinute);
  return record.endMinute - effectiveStartMinute;
}

/** 计算代表性考勤记录的首屏统计指标 */
export function calculateAttendanceSummary(
  records: AttendanceRecord[],
  endBenchmarkMinute = DEFAULT_END_BENCHMARK_MINUTE,
): AttendanceSummary {
  /** 可以进入平均值分母的完整考勤记录 */
  const validRecords = records.filter(isValidAttendanceRecord);
  /** 有效记录的在岗分钟列表 */
  const presenceValues = validRecords.map((record) => calculatePresenceMinutes(record)).filter((minutes): minutes is number => minutes !== null);
  /** 所有有效记录的在岗分钟总和 */
  const totalPresenceMinutes = presenceValues.reduce((total, minutes) => total + minutes, 0);
  /** 所有有效记录的下班时刻总和 */
  const totalEndMinutes = validRecords.reduce((total, record) => total + (record.endMinute ?? 0), 0);

  return {
    validAttendanceDays: validRecords.length,
    excludedDays: records.length - validRecords.length,
    averagePresenceMinutes: validRecords.length > 0 ? Math.round(totalPresenceMinutes / validRecords.length) : null,
    averageEndMinute: validRecords.length > 0 ? Math.round(totalEndMinutes / validRecords.length) : null,
    afterBenchmarkDays: validRecords.filter((record) => (record.endMinute ?? 0) > endBenchmarkMinute).length,
    overnightDays: validRecords.filter((record) => record.overnightState === "linked" || record.overnightState === "confirmed").length,
    ambiguousDays: records.filter((record) => record.attendanceState === "ambiguous-start" || record.overnightState === "ambiguous").length,
    releaseDays: validRecords.filter((record) => record.isReleaseDay).length,
  };
}

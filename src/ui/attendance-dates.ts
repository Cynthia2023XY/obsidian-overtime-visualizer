import type { AttendanceRecord } from "../types/attendance";

/** 只提取实际有打卡信息的日期，保留单次打卡和休息日出勤，供趋势与每日记录共用 */
export function getAttendanceDates(records: AttendanceRecord[]): string[] {
    return [...new Set(records.filter((record) => record.startMinute !== null || record.endMinute !== null).map((record) => record.date))].sort();
}

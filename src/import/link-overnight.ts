import type { AttendanceRecord } from "../types/attendance";
import type { OvernightLinkResult } from "../types/import";

/** 返回 ISO 日期紧邻的下一个自然日 */
function getNextDate(date: string): string {
  /** 当前 ISO 日期的 UTC 日期对象 */
  const currentDate = new Date(`${date}T00:00:00Z`);
  currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  return currentDate.toISOString().slice(0, 10);
}

/** 创建可安全修改派生字段的考勤记录副本 */
function cloneRecord(record: AttendanceRecord): AttendanceRecord {
  return {
    ...record,
    leaveReasons: [...record.leaveReasons],
    warnings: [...record.warnings],
    source: { ...record.source },
  };
}

/** 关联跨夜日与次日凌晨打卡，并标记无法恢复的次日起始时间 */
export function linkOvernightRecords(
  inputRecords: AttendanceRecord[],
  overnightCutoffMinute: number,
): OvernightLinkResult {
  /** 按日期排序且可修改的考勤记录 */
  const records = inputRecords.map(cloneRecord).sort((left, right) => left.date.localeCompare(right.date));
  /** 用于快速查找次日记录的日期索引 */
  const recordsByDate = new Map(records.map((record) => [record.date, record]));
  /** 跨夜关联过程中需要向用户展示的警告 */
  const warnings: string[] = [];

  records.forEach((record) => {
    if (record.overnightState !== "confirmed") return;
    /** 当前跨夜日紧邻的次日记录 */
    const nextRecord = recordsByDate.get(getNextDate(record.date));
    if (!nextRecord || nextRecord.startMinute === null || nextRecord.startMinute >= overnightCutoffMinute) {
      /** 无法建立跨夜关联时的可审核警告 */
      const warning = `${record.date} 标记了跨夜加班，但未找到次日 ${overnightCutoffMinute / 60}:00 前打卡`;
      record.overnightState = "ambiguous";
      record.warnings.push(warning);
      warnings.push(warning);
      return;
    }

    record.endMinute = 1_440 + nextRecord.startMinute;
    record.overnightState = "linked";
    record.attendanceState = "complete";
    nextRecord.attendanceState = "ambiguous-start";
    /** 次日最早打卡已被前日跨夜使用的警告 */
    const nextDayWarning = `${nextRecord.date} 的最早打卡已作为 ${record.date} 的跨夜结束，当日上班时间待手工修正`;
    nextRecord.warnings.push(nextDayWarning);
    warnings.push(nextDayWarning);
  });

  return { records, warnings };
}

import { calculatePresenceMinutes } from "../analytics/summary";
import type { AttendanceRecord } from "../types/attendance";
import type { AttendanceTableRowViewModel, CalendarCellViewModel } from "../types/view-model";
import { formatClockMinute, formatDuration } from "../utils/time";

/** 考勤状态到中文展示文案的映射 */
const STATE_LABELS: Record<AttendanceRecord["attendanceState"], string> = {
  complete: "完整",
  "non-working-day": "非工作日",
  "full-leave": "整天请假",
  "partial-leave": "部分请假",
  "missing-punch": "缺卡",
  incomplete: "打卡不完整",
  "ambiguous-start": "起始待修正",
};

/** 将在岗分钟映射为热力图 1 至 5 级强度 */
function mapPresenceIntensity(minutes: number | null): 0 | 1 | 2 | 3 | 4 | 5 {
  if (minutes === null) return 0;
  if (minutes < 9 * 60) return 1;
  if (minutes < 10 * 60) return 2;
  if (minutes < 11 * 60) return 3;
  if (minutes < 12 * 60) return 4;
  return 5;
}

/** 将规范化记录映射为数据管理表格行 */
export function mapAttendanceTableRows(records: AttendanceRecord[]): AttendanceTableRowViewModel[] {
  return [...records].sort((left, right) => right.date.localeCompare(left.date)).map((record) => ({
    date: record.date,
    weekday: `周${["一", "二", "三", "四", "五", "六", "日"][record.weekday - 1] ?? "?"}`,
    type: `${record.dayType === "workday" ? "工作日" : record.dayType === "holiday" ? "假日" : record.dayType === "rest-day" ? "休息日" : "未知日类型"}${record.isReleaseDay ? " · 上线" : ""}`,
    start: formatClockMinute(record.startMinute),
    end: formatClockMinute(record.endMinute),
    duration: formatDuration(calculatePresenceMinutes(record)),
    state: record.overnightState === "linked" ? "跨夜" : STATE_LABELS[record.attendanceState],
  }));
}

/** 将指定月份的记录映射为包含空白日期的日历热力单元格 */
export function mapCalendarCells(records: AttendanceRecord[], month: string): CalendarCellViewModel[] {
  /** 指定月份中的年份 */
  const year = Number(month.slice(0, 4));
  /** 指定月份中的月数 */
  const monthNumber = Number(month.slice(5, 7));
  /** 指定月份包含的自然日数 */
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  /** 指定月份中按日期查找的记录 */
  const recordsByDate = new Map(records.filter((record) => record.date.startsWith(month)).map((record) => [record.date, record]));

  return Array.from({ length: daysInMonth }, (_value, index) => {
    /** 当前热力单元格对应的自然日 */
    const day = index + 1;
    /** 当前热力单元格对应的 ISO 日期 */
    const date = `${month}-${String(day).padStart(2, "0")}`;
    /** 当前日期的规范化考勤记录 */
    const record = recordsByDate.get(date);
    /** 当前日期的有效在岗分钟 */
    const presenceMinutes = record ? calculatePresenceMinutes(record) : null;
    /** 当前日期的特殊热力标记 */
    const modifier = record?.overnightState === "linked" ? "overnight" : record?.attendanceState === "full-leave" ? "leave" : record?.dayType !== "workday" && presenceMinutes !== null ? "weekend-work" : record?.isReleaseDay ? "release" : undefined;
    return {
      date,
      day,
      intensity: mapPresenceIntensity(presenceMinutes),
      label: record ? `${date} ${STATE_LABELS[record.attendanceState]}，在岗 ${formatDuration(presenceMinutes)}` : `${date} 无数据`,
      modifier,
    };
  });
}

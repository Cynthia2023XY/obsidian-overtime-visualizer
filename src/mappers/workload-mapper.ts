import { calculateWorkloadMetrics } from "../analytics/workload-evaluation";
import type { AttendanceRecord } from "../types/attendance";
import type { DepartureTrendPointViewModel, RollingHeatmapCellViewModel, SummaryCardViewModel } from "../types/view-model";
import { formatMonthDay, shiftIsoDate } from "../utils/date";
import { formatClockMinute } from "../utils/time";

/** 星期数字到中文简称的稳定映射 */
const WEEKDAY_LABELS: Record<number, string> = { 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日" };

/** 将可空百分比格式化为指标卡详情 */
function formatRatio(ratio: number | null, denominator: number): string {
  return ratio === null ? "有效下班数据不足" : `占 ${denominator} 个有效出勤日的 ${ratio}%`;
}

/** 将指定范围记录映射为四项核心首屏指标 */
export function mapWorkloadSummaryCards(records: AttendanceRecord[]): SummaryCardViewModel[] {
  /** 指定范围的工作压力核心指标 */
  const metrics = calculateWorkloadMetrics(records);
  return [
    { label: "21:00 后下班", value: `${metrics.afterNineDays} 天`, detail: formatRatio(metrics.afterNineRatio, metrics.validAttendanceDays), tone: metrics.afterNineDays > 10 ? "danger" : "warning" },
    { label: "22:00 后下班", value: `${metrics.afterTenDays} 天`, detail: formatRatio(metrics.afterTenRatio, metrics.validAttendanceDays), tone: metrics.afterTenDays > 2 ? "danger" : "warning" },
    { label: "跨夜加班", value: `${metrics.overnightDays} 天`, detail: formatRatio(metrics.overnightRatio, metrics.validAttendanceDays), tone: metrics.overnightDays > 0 ? "danger" : "neutral" },
    { label: "周末加班", value: `${metrics.weekendWorkDays} 天`, detail: "仅统计周六、周日的有效考勤", tone: metrics.weekendWorkDays > 0 ? "warning" : "neutral" },
  ];
}

/** 判断下班时间在折线图和热力图中的颜色等级 */
function resolveDepartureTone(record: AttendanceRecord | undefined): DepartureTrendPointViewModel["tone"] {
  if (!record || record.endMinute === null) return "missing";
  if (record.overnightState === "linked" || record.overnightState === "confirmed" || record.endMinute >= 24 * 60) return "overnight";
  if (record.endMinute > 22 * 60) return "after-ten";
  if (record.endMinute > 21 * 60) return "after-nine";
  return "normal";
}

/** 将所选范围记录映射为按日期升序的下班时间折线点 */
export function mapDepartureTrendPoints(records: AttendanceRecord[]): DepartureTrendPointViewModel[] {
  return records
    .filter((record) => record.startMinute !== null || record.endMinute !== null)
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((record) => ({
    date: record.date,
    dateLabel: formatMonthDay(record.date),
    weekday: WEEKDAY_LABELS[record.weekday] ?? "未知",
    endMinute: record.endMinute,
    endLabel: formatClockMinute(record.endMinute),
    tone: resolveDepartureTone(record),
    isWeekend: record.weekday === 6 || record.weekday === 7,
    }));
}

/** 将最近连续 30 个自然日映射为固定长度下班热力单元格 */
export function mapRollingHeatmapCells(records: AttendanceRecord[], endDate: string): RollingHeatmapCellViewModel[] {
  /** 按日期读取考勤记录的索引 */
  const recordsByDate = new Map(records.map((record) => [record.date, record]));
  /** 最近 30 天窗口的起始日期 */
  const startDate = shiftIsoDate(endDate, -29);
  return Array.from({ length: 30 }, (_value, index) => {
    /** 当前热力单元格对应的自然日期 */
    const date = shiftIsoDate(startDate, index);
    /** 当前日期对应的本地考勤记录 */
    const record = recordsByDate.get(date);
    if (!record || (record.startMinute === null && record.endMinute === null)) return null;
    /** 当前日期的周一制星期数字 */
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    /** 当前日期的下班压力颜色等级 */
    const tone = resolveDepartureTone(record);
    /** 当前日期的下班时间展示值 */
    const endLabel = formatClockMinute(record?.endMinute ?? null);
    return {
      date,
      dateLabel: formatMonthDay(date),
      weekdayLabel: WEEKDAY_LABELS[weekday] ?? "未知",
      endLabel,
      tone: tone === "normal" ? "before-nine" : tone,
      isWeekend: weekday === 6 || weekday === 7,
      label: `${date} ${WEEKDAY_LABELS[weekday] ?? "未知"}，${record?.endMinute === null || !record ? "无有效下班时间" : `下班 ${endLabel}`}`,
    };
  }).filter((cell): cell is RollingHeatmapCellViewModel => cell !== null);
}

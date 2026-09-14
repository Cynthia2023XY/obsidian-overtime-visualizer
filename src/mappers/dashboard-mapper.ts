import { calculateAttendanceSummary, calculatePresenceMinutes, DEFAULT_END_BENCHMARK_MINUTE, DEFAULT_START_FLOOR_MINUTE } from "../analytics/summary";
import type { AttendanceRecord } from "../types/attendance";
import type { SummaryCardViewModel, TimelinePointViewModel } from "../types/view-model";
import { formatClockMinute, formatDuration, formatMinuteDeviation } from "../utils/time";

/** 星期数字到中文简称的稳定映射 */
const WEEKDAY_LABELS: Record<number, string> = { 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日" };

/** 将规范化考勤记录映射为首屏指标卡 */
export function mapSummaryCards(records: AttendanceRecord[]): SummaryCardViewModel[] {
  /** 考勤记录聚合得到的数值指标 */
  const summary = calculateAttendanceSummary(records);
  /** 21:00 后下班天数占有效样本的整数百分比 */
  const afterBenchmarkRatio = summary.validAttendanceDays > 0 ? Math.round(summary.afterBenchmarkDays / summary.validAttendanceDays * 100) : 0;

  return [
    { label: "有效出勤", value: `${summary.validAttendanceDays} 天`, detail: `排除 ${summary.excludedDays} 条无效或待修正数据`, tone: "neutral" },
    { label: "平均在岗", value: formatDuration(summary.averagePresenceMinutes), detail: `样本数 n=${summary.validAttendanceDays}`, tone: "positive" },
    { label: "平均下班", value: formatClockMinute(summary.averageEndMinute), detail: formatMinuteDeviation(summary.averageEndMinute === null ? null : summary.averageEndMinute - DEFAULT_END_BENCHMARK_MINUTE), tone: "warning" },
    { label: "21:00 后下班", value: `${summary.afterBenchmarkDays} 天`, detail: `占有效出勤 ${afterBenchmarkRatio}%`, tone: "warning" },
    { label: "跨夜记录", value: `${summary.overnightDays} 天`, detail: `${summary.ambiguousDays} 条次日数据待修正`, tone: "danger" },
    { label: "上线日", value: `${summary.releaseDays} 天`, detail: "当前试点口径：周二、周四", tone: "neutral" },
  ];
}

/** 将有效考勤记录映射为 ECharts 日级时间轴数据 */
export function mapTimelinePoints(records: AttendanceRecord[]): TimelinePointViewModel[] {
  return records.flatMap((record) => {
    /** 当前考勤记录的有效在岗分钟数 */
    const presenceMinutes = calculatePresenceMinutes(record);
    if (presenceMinutes === null || record.startMinute === null || record.endMinute === null) return [];

    /** 依照 09:00 早到口径修正的时间轴起点 */
    const effectiveStartMinute = Math.max(record.startMinute, DEFAULT_START_FLOOR_MINUTE);
    /** 当前日期在时间轴上的特殊标记 */
    const modifier = record.overnightState === "linked" || record.overnightState === "confirmed" ? "overnight" : record.isReleaseDay ? "release" : undefined;

    return [{
      date: record.date.slice(5),
      weekday: WEEKDAY_LABELS[record.weekday] ?? "未知",
      startMinute: effectiveStartMinute,
      endMinute: record.endMinute,
      presenceMinutes,
      startLabel: formatClockMinute(record.startMinute),
      endLabel: formatClockMinute(record.endMinute),
      modifier,
    }];
  });
}

import { calculatePresenceMinutes, isValidAttendanceRecord } from "./summary";
import type { AttendanceRecord } from "../types/attendance";
import type { PeriodMetricViewModel, WeekdayMetricViewModel } from "../types/view-model";

/** 星期维度指标使用的中文简称 */
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 计算排序数值列表的中位数 */
function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  /** 从小到大排序且不修改原数组的数值 */
  const sortedValues = [...values].sort((left, right) => left - right);
  /** 排序列表的中间下标 */
  const middleIndex = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middleIndex] ?? null;
  return Math.round(((sortedValues[middleIndex - 1] ?? 0) + (sortedValues[middleIndex] ?? 0)) / 2);
}

/** 按自然月聚合平均在岗、平均下班和排除数 */
export function aggregateByMonth(records: AttendanceRecord[]): PeriodMetricViewModel[] {
  /** 按 YYYY-MM 归类的规范化考勤记录 */
  const groups = new Map<string, AttendanceRecord[]>();
  records.forEach((record) => {
    /** 当前记录所在的自然月 */
    const period = record.date.slice(0, 7);
    groups.set(period, [...(groups.get(period) ?? []), record]);
  });

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, periodRecords]) => {
    /** 当月可参与平均值计算的记录 */
    const validRecords = periodRecords.filter(isValidAttendanceRecord);
    /** 当月的有效在岗分钟 */
    const presenceValues = validRecords.map((record) => calculatePresenceMinutes(record)).filter((value): value is number => value !== null);
    /** 当月的在岗总分钟 */
    const totalPresenceMinutes = presenceValues.reduce((total, value) => total + value, 0);
    /** 当月的下班时刻总分钟 */
    const totalEndMinutes = validRecords.reduce((total, record) => total + record.endMinute, 0);
    return {
      period,
      label: `${Number(period.slice(5))}月`,
      averagePresenceMinutes: validRecords.length ? Math.round(totalPresenceMinutes / validRecords.length) : null,
      averageEndMinute: validRecords.length ? Math.round(totalEndMinutes / validRecords.length) : null,
      sampleCount: validRecords.length,
      excludedCount: periodRecords.length - validRecords.length,
    };
  });
}

/** 按周一至周日聚合平均和中位下班时间 */
export function aggregateByWeekday(records: AttendanceRecord[]): WeekdayMetricViewModel[] {
  return WEEKDAY_LABELS.map((label, index) => {
    /** 当前星期对应的 ISO 星期数字 */
    const weekday = index + 1;
    /** 当前星期中所有可参与统计的下班时刻 */
    const endMinutes = records.filter(isValidAttendanceRecord).filter((record) => record.weekday === weekday).map((record) => record.endMinute);
    /** 当前星期的下班时刻总分钟 */
    const totalEndMinutes = endMinutes.reduce((total, value) => total + value, 0);
    return {
      weekday,
      label,
      averageEndMinute: endMinutes.length ? Math.round(totalEndMinutes / endMinutes.length) : null,
      medianEndMinute: calculateMedian(endMinutes),
      sampleCount: endMinutes.length,
    };
  });
}

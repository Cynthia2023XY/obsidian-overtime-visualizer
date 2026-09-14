import type { AttendanceRecord } from "../types/attendance";
import { formatLocalIsoDate, shiftIsoDate } from "../utils/date";

/** 拥有可用于下班分析时间的考勤记录 */
type ReliableDepartureRecord = AttendanceRecord & { endMinute: number };

/** 工作压力评价等级 */
export type WorkloadLevel = "relaxed" | "moderate" | "tired" | "painful" | "insufficient";

/** 指定时间段内与下班压力直接相关的统计结果 */
export interface WorkloadMetrics {
  validAttendanceDays: number;
  afterNineDays: number;
  afterNineRatio: number | null;
  afterTenDays: number;
  afterTenRatio: number | null;
  overnightDays: number;
  overnightRatio: number | null;
  weekendWorkDays: number;
}

/** 单个评价维度的等级、计数和说明 */
export interface WorkloadDimensionEvaluation {
  level: WorkloadLevel;
  label: string;
  count: number;
  description: string;
}

/** 当前 30 天与前 30 天下班时间对比结果 */
export interface DepartureComparison {
  currentMedianMinute: number | null;
  previousMedianMinute: number | null;
  differenceMinute: number | null;
  direction: "earlier" | "later" | "stable" | "insufficient";
}

/** 固定滚动 30 天的工作压力评价 */
export interface RollingWorkloadEvaluation {
  rangeStart: string;
  rangeEnd: string;
  previousRangeStart: string;
  previousRangeEnd: string;
  metrics: WorkloadMetrics;
  afterNine: WorkloadDimensionEvaluation;
  afterTen: WorkloadDimensionEvaluation;
  overallLevel: WorkloadLevel;
  overallLabel: string;
  comparison: DepartureComparison;
}

/** 工作压力等级从轻到重的排序 */
const LEVEL_RANK: Record<Exclude<WorkloadLevel, "insufficient">, number> = {
  relaxed: 0,
  moderate: 1,
  tired: 2,
  painful: 3,
};

/** 工作压力等级对应的中文标签 */
const LEVEL_LABELS: Record<WorkloadLevel, string> = {
  relaxed: "轻松",
  moderate: "适中",
  tired: "疲惫",
  painful: "痛苦",
  insufficient: "数据不足",
};

/** 计算安全的整数百分比，无有效分母时返回空值 */
function calculateRatio(count: number, total: number): number | null {
  return total > 0 ? Math.round(count / total * 100) : null;
}

/** 计算分钟列表的中位数，降低偶发跨夜对趋势判断的影响 */
function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  /** 不修改原列表的升序分钟值 */
  const sortedValues = [...values].sort((left, right) => left - right);
  /** 排序列表的中间位置 */
  const middleIndex = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middleIndex] ?? null;
  return Math.round(((sortedValues[middleIndex - 1] ?? 0) + (sortedValues[middleIndex] ?? 0)) / 2);
}

/** 截取包含起止日期的考勤记录 */
function filterDateRange(records: AttendanceRecord[], startDate: string, endDate: string): AttendanceRecord[] {
  return records.filter((record) => record.date >= startDate && record.date <= endDate);
}

/** 判断记录是否拥有可用于晚下班分析的下班时间 */
function hasReliableDeparture(record: AttendanceRecord): record is ReliableDepartureRecord {
  return record.endMinute !== null;
}

/** 统计指定记录中的九点后、十点后、跨夜和周末加班 */
export function calculateWorkloadMetrics(records: AttendanceRecord[]): WorkloadMetrics {
  /** 可进入比例分母且拥有可信下班时间的记录 */
  const validRecords = records.filter(hasReliableDeparture);
  /** 严格晚于 21:00 的有效记录 */
  const afterNineDays = validRecords.filter((record) => record.endMinute > 21 * 60).length;
  /** 严格晚于 22:00 的有效记录 */
  const afterTenDays = validRecords.filter((record) => record.endMinute > 22 * 60).length;
  /** 已确认或完成相邻日关联的跨夜记录 */
  const overnightDays = validRecords.filter((record) => record.overnightState === "linked" || record.overnightState === "confirmed").length;
  /** 周六或周日存在有效考勤的记录 */
  const weekendWorkDays = validRecords.filter((record) => record.weekday === 6 || record.weekday === 7).length;
  return {
    validAttendanceDays: validRecords.length,
    afterNineDays,
    afterNineRatio: calculateRatio(afterNineDays, validRecords.length),
    afterTenDays,
    afterTenRatio: calculateRatio(afterTenDays, validRecords.length),
    overnightDays,
    overnightRatio: calculateRatio(overnightDays, validRecords.length),
    weekendWorkDays,
  };
}

/** 按用户设定区间评价近 30 天九点后下班压力 */
function evaluateAfterNine(count: number, hasData: boolean): WorkloadDimensionEvaluation {
  if (!hasData) return { level: "insufficient", label: LEVEL_LABELS.insufficient, count, description: "近 30 天没有有效下班记录" };
  if (count <= 5) return { level: "relaxed", label: LEVEL_LABELS.relaxed, count, description: "平均每周约 1 天九点后下班" };
  if (count <= 10) return { level: "moderate", label: LEVEL_LABELS.moderate, count, description: "接近每周 2 天九点后下班" };
  if (count <= 15) return { level: "tired", label: LEVEL_LABELS.tired, count, description: "九点后下班已经较为频繁" };
  return { level: "painful", label: LEVEL_LABELS.painful, count, description: "超过一半日期九点后下班" };
}

/** 按用户设定区间评价近 30 天十点后下班压力 */
function evaluateAfterTen(count: number, hasData: boolean): WorkloadDimensionEvaluation {
  if (!hasData) return { level: "insufficient", label: LEVEL_LABELS.insufficient, count, description: "近 30 天没有有效下班记录" };
  if (count <= 2) return { level: "relaxed", label: "适中", count, description: "这个月十点后下班不超过 2 天" };
  if (count <= 4) return { level: "tired", label: LEVEL_LABELS.tired, count, description: "几乎每周都有十点后下班" };
  return { level: "painful", label: LEVEL_LABELS.painful, count, description: "十点后下班明显过于频繁" };
}

/** 比较两个连续 30 天窗口的下班时间中位数 */
function compareDepartureTimes(currentRecords: AttendanceRecord[], previousRecords: AttendanceRecord[]): DepartureComparison {
  /** 当前窗口所有有效下班分钟 */
  const currentEndMinutes = currentRecords.filter(hasReliableDeparture).map((record) => record.endMinute);
  /** 前一窗口所有有效下班分钟 */
  const previousEndMinutes = previousRecords.filter(hasReliableDeparture).map((record) => record.endMinute);
  /** 当前窗口下班时间中位数 */
  const currentMedianMinute = calculateMedian(currentEndMinutes);
  /** 前一窗口下班时间中位数 */
  const previousMedianMinute = calculateMedian(previousEndMinutes);
  if (currentEndMinutes.length < 3 || previousEndMinutes.length < 3 || currentMedianMinute === null || previousMedianMinute === null) {
    return { currentMedianMinute, previousMedianMinute, differenceMinute: null, direction: "insufficient" };
  }
  /** 当前窗口相对前一窗口的下班时间分钟差 */
  const differenceMinute = currentMedianMinute - previousMedianMinute;
  /** 15 分钟以内视为正常波动 */
  const direction = Math.abs(differenceMinute) <= 15 ? "stable" : differenceMinute > 0 ? "later" : "earlier";
  return { currentMedianMinute, previousMedianMinute, differenceMinute, direction };
}

/** 取两个压力维度中严重程度更高的综合等级 */
function resolveOverallLevel(afterNine: WorkloadDimensionEvaluation, afterTen: WorkloadDimensionEvaluation): WorkloadLevel {
  if (afterNine.level === "insufficient" || afterTen.level === "insufficient") return "insufficient";
  return LEVEL_RANK[afterNine.level] >= LEVEL_RANK[afterTen.level] ? afterNine.level : afterTen.level;
}

/** 以今天为末日计算当前与前一连续 30 天压力评价 */
export function evaluateRollingThirtyDays(records: AttendanceRecord[], today: Date = new Date()): RollingWorkloadEvaluation {
  /** 当前 30 天窗口的结束日期 */
  const rangeEnd = formatLocalIsoDate(today);
  /** 当前 30 天窗口的起始日期 */
  const rangeStart = shiftIsoDate(rangeEnd, -29);
  /** 前一 30 天窗口的结束日期 */
  const previousRangeEnd = shiftIsoDate(rangeStart, -1);
  /** 前一 30 天窗口的起始日期 */
  const previousRangeStart = shiftIsoDate(previousRangeEnd, -29);
  /** 当前连续 30 天记录 */
  const currentRecords = filterDateRange(records, rangeStart, rangeEnd);
  /** 前一连续 30 天记录 */
  const previousRecords = filterDateRange(records, previousRangeStart, previousRangeEnd);
  /** 当前连续 30 天核心指标 */
  const metrics = calculateWorkloadMetrics(currentRecords);
  /** 九点后下班压力评价 */
  const afterNine = evaluateAfterNine(metrics.afterNineDays, metrics.validAttendanceDays > 0);
  /** 十点后下班压力评价 */
  const afterTen = evaluateAfterTen(metrics.afterTenDays, metrics.validAttendanceDays > 0);
  /** 两个维度合并后的综合压力等级 */
  const overallLevel = resolveOverallLevel(afterNine, afterTen);
  return {
    rangeStart,
    rangeEnd,
    previousRangeStart,
    previousRangeEnd,
    metrics,
    afterNine,
    afterTen,
    overallLevel,
    overallLabel: LEVEL_LABELS[overallLevel],
    comparison: compareDepartureTimes(currentRecords, previousRecords),
  };
}

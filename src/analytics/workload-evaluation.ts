import type { AttendanceRecord } from "../types/attendance";
import { formatLocalIsoDate, shiftIsoDate } from "../utils/date";

/** 拥有可用于下班分析时间的考勤记录 */
type ReliableDepartureRecord = AttendanceRecord & { endMinute: number };

/** 六档晚下班时间区间的稳定标识 */
export type DepartureBandId =
  | "nine-to-nine-thirty"
  | "nine-thirty-to-ten"
  | "ten-to-eleven"
  | "eleven-to-eleven-thirty"
  | "eleven-thirty-to-midnight"
  | "overnight";

/** 工作压力评价等级 */
export type WorkloadLevel = "relaxed" | "moderate" | "tired" | "painful" | "insufficient";

/** 单个晚下班时间档位的计分与文案定义 */
interface DepartureBandDefinition {
  id: DepartureBandId;
  label: string;
  description: string;
  score: number;
}

/** 单个晚下班时间档位的统计结果 */
export interface DepartureBandMetric extends DepartureBandDefinition {
  count: number;
  ratio: number | null;
}

/** 指定时间段内与下班压力直接相关的统计结果 */
export interface WorkloadMetrics {
  validAttendanceDays: number;
  departureBands: DepartureBandMetric[];
  afterNineDays: number;
  afterTenDays: number;
  afterElevenDays: number;
  afterElevenThirtyDays: number;
  overnightDays: number;
  weekendWorkDays: number;
  releaseAfterTenDays: number;
  rawPressureScore: number;
  standardizedPressureScore: number;
}

/** 近 30 天积分换算得到的基础压力评价 */
export interface PressureScoreEvaluation {
  level: WorkloadLevel;
  label: string;
  score: number | null;
  description: string;
}

/** 当前 30 天与前 30 天的压力分对比结果 */
export interface PressureComparison {
  currentScore: number | null;
  previousScore: number | null;
  differenceScore: number | null;
  changePercent: number | null;
  direction: "improved" | "worsened" | "stable" | "insufficient";
}

/** 22:00 后下班与上线日的归因结果 */
export interface ReleaseAttribution {
  releaseDays: number;
  afterTenDays: number;
  releaseAfterTenDays: number;
  releaseShare: number | null;
  type: "release-centered" | "mixed" | "routine-spill" | "none";
  description: string;
}

/** 固定滚动 30 天的工作压力评价 */
export interface RollingWorkloadEvaluation {
  rangeStart: string;
  rangeEnd: string;
  previousRangeStart: string;
  previousRangeEnd: string;
  metrics: WorkloadMetrics;
  scoreEvaluation: PressureScoreEvaluation;
  redLineReasons: string[];
  overallLevel: WorkloadLevel;
  overallLabel: string;
  releaseAttribution: ReleaseAttribution;
  comparison: PressureComparison;
}

/** 晚下班时间档位与每日压力分的统一定义 */
const DEPARTURE_BAND_DEFINITIONS: DepartureBandDefinition[] = [
  { id: "nine-to-nine-thirty", label: "21:00–21:29", description: "相对轻松", score: 1 },
  { id: "nine-thirty-to-ten", label: "21:30–21:59", description: "事情比较多", score: 2 },
  { id: "ten-to-eleven", label: "22:00–22:59", description: "事情非常多", score: 4 },
  { id: "eleven-to-eleven-thirty", label: "23:00–23:29", description: "高强度加班", score: 6 },
  { id: "eleven-thirty-to-midnight", label: "23:30–23:59", description: "极高强度加班", score: 8 },
  { id: "overnight", label: "次日 00:00 及以后", description: "跨夜加班", score: 12 },
];

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

/** 将数值四舍五入到一位小数 */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 截取包含起止日期的考勤记录 */
function filterDateRange(records: AttendanceRecord[], startDate: string, endDate: string): AttendanceRecord[] {
  return records.filter((record) => record.date >= startDate && record.date <= endDate);
}

/** 判断记录是否拥有可用于晚下班分析的下班时间 */
function hasReliableDeparture(record: AttendanceRecord): record is ReliableDepartureRecord {
  return record.endMinute !== null;
}

/** 判断记录是否属于已确认的跨夜加班 */
function isOvernightDeparture(record: ReliableDepartureRecord): boolean {
  return record.overnightState === "linked" || record.overnightState === "confirmed" || record.endMinute >= 24 * 60;
}

/** 将单日下班时间映射到互斥的晚下班档位 */
function resolveDepartureBandId(record: ReliableDepartureRecord): DepartureBandId | null {
  if (isOvernightDeparture(record)) return "overnight";
  if (record.endMinute >= 23 * 60 + 30) return "eleven-thirty-to-midnight";
  if (record.endMinute >= 23 * 60) return "eleven-to-eleven-thirty";
  if (record.endMinute >= 22 * 60) return "ten-to-eleven";
  if (record.endMinute >= 21 * 60 + 30) return "nine-thirty-to-ten";
  if (record.endMinute >= 21 * 60) return "nine-to-nine-thirty";
  return null;
}

/** 统计指定记录中的六档晚下班、红线次数与压力积分 */
export function calculateWorkloadMetrics(records: AttendanceRecord[]): WorkloadMetrics {
  /** 可进入比例分母且拥有可信下班时间的记录 */
  const validRecords = records.filter(hasReliableDeparture);
  /** 每个晚下班档位的记录数索引 */
  const bandCounts = new Map<DepartureBandId, number>(DEPARTURE_BAND_DEFINITIONS.map((definition) => [definition.id, 0]));
  validRecords.forEach((record) => {
    /** 当前有效记录对应的晚下班档位 */
    const bandId = resolveDepartureBandId(record);
    if (bandId) bandCounts.set(bandId, (bandCounts.get(bandId) ?? 0) + 1);
  });
  /** 六个互斥晚下班档位的完整统计 */
  const departureBands = DEPARTURE_BAND_DEFINITIONS.map((definition) => ({
    ...definition,
    count: bandCounts.get(definition.id) ?? 0,
    ratio: calculateRatio(bandCounts.get(definition.id) ?? 0, validRecords.length),
  }));
  /** 21:00 及以后下班的总天数 */
  const afterNineDays = departureBands.reduce((total, band) => total + band.count, 0);
  /** 22:00 及以后下班的总天数 */
  const afterTenDays = departureBands.slice(2).reduce((total, band) => total + band.count, 0);
  /** 23:00 及以后下班的总天数 */
  const afterElevenDays = departureBands.slice(3).reduce((total, band) => total + band.count, 0);
  /** 23:30 及以后下班的总天数 */
  const afterElevenThirtyDays = departureBands.slice(4).reduce((total, band) => total + band.count, 0);
  /** 跨夜档位的总天数 */
  const overnightDays = bandCounts.get("overnight") ?? 0;
  /** 原始压力分总和 */
  const rawPressureScore = departureBands.reduce((total, band) => total + band.count * band.score, 0);
  /** 折算为 20 个有效出勤日的标准化压力分 */
  const standardizedPressureScore = validRecords.length > 0 ? roundToOneDecimal(rawPressureScore / validRecords.length * 20) : 0;
  return {
    validAttendanceDays: validRecords.length,
    departureBands,
    afterNineDays,
    afterTenDays,
    afterElevenDays,
    afterElevenThirtyDays,
    overnightDays,
    weekendWorkDays: validRecords.filter((record) => record.weekday === 6 || record.weekday === 7).length,
    releaseAfterTenDays: validRecords.filter((record) => record.isReleaseDay && (isOvernightDeparture(record) || record.endMinute >= 22 * 60)).length,
    rawPressureScore,
    standardizedPressureScore,
  };
}

/** 按标准化压力分生成基础等级 */
function evaluatePressureScore(metrics: WorkloadMetrics): PressureScoreEvaluation {
  if (metrics.validAttendanceDays === 0) {
    return { level: "insufficient", label: LEVEL_LABELS.insufficient, score: null, description: "近 30 天没有有效下班记录" };
  }
  /** 已折算到 20 个出勤日的压力分 */
  const score = metrics.standardizedPressureScore;
  if (score <= 5) return { level: "relaxed", label: LEVEL_LABELS.relaxed, score, description: "晚下班较少，总体轻松" };
  if (score <= 10) return { level: "moderate", label: LEVEL_LABELS.moderate, score, description: "晚下班存在，但总体可控" };
  if (score <= 20) return { level: "tired", label: LEVEL_LABELS.tired, score, description: "高频晚归或 22:00 后下班已经明显" };
  return { level: "painful", label: LEVEL_LABELS.painful, score, description: "晚归频繁或存在多次极晚下班" };
}

/** 根据频率与极端加班情况生成强制升级红线 */
function resolveRedLineReasons(metrics: WorkloadMetrics): string[] {
  /** 当前周期触发的全部压力红线 */
  const reasons: string[] = [];
  if (metrics.afterNineDays >= 16) reasons.push("21:00 后下班达到 16 天");
  if (metrics.afterTenDays >= 5) reasons.push("22:00 后下班达到 5 天");
  if (metrics.afterElevenDays >= 3) reasons.push("23:00 后下班达到 3 天");
  if (metrics.afterElevenThirtyDays >= 2) reasons.push("23:30 后下班达到 2 天");
  if (metrics.overnightDays >= 2) reasons.push("跨夜加班达到 2 天");
  return reasons;
}

/** 结合积分、跨夜下限与痛苦红线得到最终评价 */
function resolveOverallLevel(scoreLevel: WorkloadLevel, metrics: WorkloadMetrics, redLineReasons: string[]): WorkloadLevel {
  if (scoreLevel === "insufficient") return "insufficient";
  if (redLineReasons.length > 0) return "painful";
  if (metrics.overnightDays === 1 && LEVEL_RANK[scoreLevel] < LEVEL_RANK.tired) return "tired";
  return scoreLevel;
}

/** 解释 22:00 后下班是否主要由上线日造成 */
function evaluateReleaseAttribution(records: AttendanceRecord[], metrics: WorkloadMetrics): ReleaseAttribution {
  /** 有可信下班时间的上线日总数 */
  const releaseDays = records.filter(hasReliableDeparture).filter((record) => record.isReleaseDay).length;
  if (metrics.afterTenDays === 0) {
    return { releaseDays, afterTenDays: 0, releaseAfterTenDays: 0, releaseShare: null, type: "none", description: "近 30 天没有 22:00 后下班" };
  }
  /** 22:00 后下班中发生在上线日的比例 */
  const releaseShare = calculateRatio(metrics.releaseAfterTenDays, metrics.afterTenDays) ?? 0;
  if (releaseShare >= 70) {
    return { releaseDays, afterTenDays: metrics.afterTenDays, releaseAfterTenDays: metrics.releaseAfterTenDays, releaseShare, type: "release-centered", description: "高强度加班主要集中在上线日" };
  }
  if (releaseShare >= 30) {
    return { releaseDays, afterTenDays: metrics.afterTenDays, releaseAfterTenDays: metrics.releaseAfterTenDays, releaseShare, type: "mixed", description: "上线日与日常工作共同造成晚归" };
  }
  return { releaseDays, afterTenDays: metrics.afterTenDays, releaseAfterTenDays: metrics.releaseAfterTenDays, releaseShare, type: "routine-spill", description: "晚归已明显扩散到非上线日" };
}

/** 比较两个连续 30 天窗口的标准化压力分 */
function comparePressureScores(currentMetrics: WorkloadMetrics, previousMetrics: WorkloadMetrics): PressureComparison {
  if (currentMetrics.validAttendanceDays === 0 || previousMetrics.validAttendanceDays === 0) {
    return { currentScore: currentMetrics.validAttendanceDays > 0 ? currentMetrics.standardizedPressureScore : null, previousScore: previousMetrics.validAttendanceDays > 0 ? previousMetrics.standardizedPressureScore : null, differenceScore: null, changePercent: null, direction: "insufficient" };
  }
  /** 当前窗口的标准化压力分 */
  const currentScore = currentMetrics.standardizedPressureScore;
  /** 前一窗口的标准化压力分 */
  const previousScore = previousMetrics.standardizedPressureScore;
  /** 当前窗口相对前一窗口的压力分差 */
  const differenceScore = roundToOneDecimal(currentScore - previousScore);
  if (previousScore === 0) {
    return { currentScore, previousScore, differenceScore, changePercent: currentScore === 0 ? 0 : null, direction: currentScore === 0 ? "stable" : "worsened" };
  }
  /** 当前窗口相对前一窗口的压力变化百分比 */
  const changePercent = Math.round(differenceScore / previousScore * 100);
  /** ±10% 以内视为正常波动 */
  const direction = Math.abs(changePercent) <= 10 ? "stable" : changePercent > 0 ? "worsened" : "improved";
  return { currentScore, previousScore, differenceScore, changePercent, direction };
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
  /** 前一连续 30 天核心指标 */
  const previousMetrics = calculateWorkloadMetrics(previousRecords);
  /** 当前压力分对应的基础评价 */
  const scoreEvaluation = evaluatePressureScore(metrics);
  /** 当前周期触发的强制升级红线 */
  const redLineReasons = resolveRedLineReasons(metrics);
  /** 结合积分与红线的最终压力等级 */
  const overallLevel = resolveOverallLevel(scoreEvaluation.level, metrics, redLineReasons);
  return {
    rangeStart,
    rangeEnd,
    previousRangeStart,
    previousRangeEnd,
    metrics,
    scoreEvaluation,
    redLineReasons,
    overallLevel,
    overallLabel: LEVEL_LABELS[overallLevel],
    releaseAttribution: evaluateReleaseAttribution(currentRecords, metrics),
    comparison: comparePressureScores(metrics, previousMetrics),
  };
}

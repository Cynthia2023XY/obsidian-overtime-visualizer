import type { AttendanceRecord } from "../types/attendance";
import type { ReliefActivityType, ReliefEntry } from "../types/storage";

/** 解压行为在界面与统计中的稳定定义 */
export interface ReliefActivityDefinition {
  type: ReliefActivityType;
  label: string;
  incrementMinutes: number;
  unitLabel: string;
  scoreLabel: string;
}

/** 单日加班、解压与最终工作压力结算 */
export interface DailyPressureLedger {
  date: string;
  overtimeScore: number;
  reliefScore: number;
  appliedReliefScore: number;
  finalScore: number;
  status: "settled" | "pending" | "no-work";
}

/** 指定周期内三种压力指标的合计 */
export interface PressureLedgerSummary {
  overtimeScore: number;
  reliefScore: number;
  appliedReliefScore: number;
  finalScore: number;
  pendingDays: number;
}

/** 快速操作面板展示的解压行为定义 */
export const RELIEF_ACTIVITY_DEFINITIONS: ReliefActivityDefinition[] = [
  { type: "sanlian", label: "看三联周刊", incrementMinutes: 30, unitLabel: "+30 分钟", scoreLabel: "+0.5 分" },
  { type: "scientific-american", label: "看科普文章", incrementMinutes: 30, unitLabel: "+30 分钟", scoreLabel: "+0.5 分" },
  { type: "walk", label: "下楼逛一圈", incrementMinutes: 15, unitLabel: "+15 分钟", scoreLabel: "+0.2 分" },
  { type: "cycling", label: "骑车运动", incrementMinutes: 60, unitLabel: "+1 小时", scoreLabel: "+2 分" },
];

/** 将解压分数统一四舍五入到一位小数 */
function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

/** 根据当天各类行为时长计算理论解压指数 */
export function calculateReliefScore(entries: ReliefEntry[]): number {
  /** 三联周刊的当日累计阅读分钟 */
  const sanlianMinutes = entries.filter((entry) => entry.type === "sanlian").reduce((total, entry) => total + entry.durationMinutes, 0);
  /** 科普文章的当日累计阅读分钟 */
  const scienceMinutes = entries.filter((entry) => entry.type === "scientific-american").reduce((total, entry) => total + entry.durationMinutes, 0);
  /** 当日下楼散步总分钟 */
  const walkMinutes = entries.filter((entry) => entry.type === "walk").reduce((total, entry) => total + entry.durationMinutes, 0);
  /** 当日骑车运动总分钟 */
  const cyclingMinutes = entries.filter((entry) => entry.type === "cycling").reduce((total, entry) => total + entry.durationMinutes, 0);
  return roundScore(sanlianMinutes / 30 * 0.5 + scienceMinutes / 30 * 0.5 + walkMinutes / 15 * 0.2 + cyclingMinutes / 60 * 2);
}

/** 将单日考勤映射为不经标准化的加班压力分 */
export function calculateDailyOvertimeScore(record: AttendanceRecord | undefined): number {
  if (!record || record.endMinute === null) return 0;
  if (record.weekday === 6 || record.weekday === 7) return 6;
  if (record.overnightState === "linked" || record.overnightState === "confirmed" || record.endMinute >= 24 * 60) return 12;
  if (record.endMinute >= 23 * 60 + 30) return 8;
  if (record.endMinute >= 23 * 60) return 6;
  if (record.endMinute >= 22 * 60) return 4;
  if (record.endMinute >= 21 * 60 + 30) return 2;
  if (record.endMinute >= 21 * 60) return 1;
  return 0;
}

/** 结算指定日期的压力账本，解压分不得跨日抵扣 */
export function calculateDailyPressureLedger(date: string, record: AttendanceRecord | undefined, entries: ReliefEntry[], today: string): DailyPressureLedger {
  /** 当日考勤直接产生的加班压力 */
  const overtimeScore = calculateDailyOvertimeScore(record);
  /** 当日解压行为理论产生的全部分数 */
  const reliefScore = calculateReliefScore(entries);
  /** 已有可信下班时间时才视为可结算 */
  const status = date >= today ? "pending" : record?.endMinute !== null && record?.endMinute !== undefined ? "settled" : "no-work";
  /** 不超过当日加班压力的实际抵扣分 */
  const appliedReliefScore = status === "settled" ? Math.min(overtimeScore, reliefScore) : 0;
  /** 只有到达次日且已有有效下班数据时才产生最终压力分 */
  const finalScore = status === "settled" ? roundScore(Math.max(0, overtimeScore - appliedReliefScore)) : 0;
  return { date, overtimeScore, reliefScore, appliedReliefScore, finalScore, status };
}

/** 按日结算后汇总指定范围内的压力账本 */
export function summarizePressureLedger(records: AttendanceRecord[], entries: ReliefEntry[], today: string): PressureLedgerSummary {
  /** 以日期为键的考勤记录 */
  const recordsByDate = new Map(records.map((record) => [record.date, record]));
  /** 以日期为键的解压行为列表 */
  const entriesByDate = new Map<string, ReliefEntry[]>();
  entries.forEach((entry) => entriesByDate.set(entry.date, [...(entriesByDate.get(entry.date) ?? []), entry]));
  /** 需要参与日级结算的全部日期 */
  const dates = new Set([...recordsByDate.keys(), ...entriesByDate.keys()]);
  return [...dates].reduce<PressureLedgerSummary>((summary, date) => {
    /** 当前日期的独立结算结果 */
    const ledger = calculateDailyPressureLedger(date, recordsByDate.get(date), entriesByDate.get(date) ?? [], today);
    return {
      overtimeScore: roundScore(summary.overtimeScore + ledger.overtimeScore),
      reliefScore: roundScore(summary.reliefScore + ledger.reliefScore),
      appliedReliefScore: roundScore(summary.appliedReliefScore + ledger.appliedReliefScore),
      finalScore: roundScore(summary.finalScore + ledger.finalScore),
      pendingDays: summary.pendingDays + (ledger.status === "pending" ? 1 : 0),
    };
  }, { overtimeScore: 0, reliefScore: 0, appliedReliefScore: 0, finalScore: 0, pendingDays: 0 });
}

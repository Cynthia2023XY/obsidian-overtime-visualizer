import type { AttendanceRecord } from "../types/attendance";
import type { ReliefEntry } from "../types/storage";
import type { ReliefActivitySetting } from "../settings";
import { calculateDailyPressureLedger } from "./pressure-ledger";
import { calculateDepartureTrend } from "./departure-trend";

/** 一个自然周期内按相同已结算考勤天数计算的压力日均值 */
export interface PressurePeriod {
    /** 自然周期起点 */
    start: string;
    /** 自然周期终点 */
    end: string;
    /** 已结算且有下班记录的天数，包含零压力日和周末出勤 */
    count: number;
    /** 解压抵扣前的平均加班压力 */
    overtime: number | null;
    /** 逐日封顶抵扣后的平均最终压力 */
    final: number | null;
}

/** 沿用全量自然周期范围，先按日抵扣再计算可对比的两条平均曲线 */
export function calculatePressureTrend(records: AttendanceRecord[], entries: ReliefEntry[], today: string, unit: "month" | "week", settings?: ReliefActivitySetting[]): PressurePeriod[] {
    // 同一天只结算一次，保持与压力账本的日期去重口径一致
    const daily = [...new Map(records.map((record) => [record.date, record])).values()].map((record) => calculateDailyPressureLedger(record.date, record, entries.filter((entry) => entry.date === record.date), today, settings)).filter((ledger) => ledger.status === "settled");
    return calculateDepartureTrend(records, unit).map(({ start, end }) => {
        // 两条曲线使用完全相同的已结算日期，避免缺失日期造成假下降
        const samples = daily.filter((ledger) => ledger.date >= start && ledger.date <= end);
        return {
            start, end, count: samples.length,
            overtime: samples.length ? samples.reduce((sum, ledger) => sum + ledger.overtimeScore, 0) / samples.length : null,
            final: samples.length ? samples.reduce((sum, ledger) => sum + ledger.finalScore, 0) / samples.length : null,
        };
    });
}

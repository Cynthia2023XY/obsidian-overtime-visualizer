import type { AttendanceRecord } from "../types/attendance";
import { calculateWorkloadMetrics } from "./workload-evaluation";
import { shiftIsoDate } from "../utils/date";

/** 单个自然周期的平均下班时间及有效样本量 */
export interface DeparturePeriod {
    /** 周期起始日期 */
    start: string;
    /** 周期结束日期 */
    end: string;
    /** 与主卡片一致的平均下班分钟，保留跨夜偏移 */
    minute: number | null;
    /** 周一至周四有效出勤天数 */
    count: number;
}

/** 按所有考勤覆盖的自然月或自然周聚合，空周期保留断点 */
export function calculateDepartureTrend(records: AttendanceRecord[], unit: "month" | "week"): DeparturePeriod[] {
    // 按日期排序的独立副本，避免改变仓储顺序
    const sorted = [...records].sort((left, right) => left.date.localeCompare(right.date));
    if (!sorted.length) return [];
    // 首末记录决定完整周期范围
    const first = sorted[0]!.date;
    // 最后一条考勤的日期
    const last = sorted[sorted.length - 1]!.date;
    // 自然周始终从周一开始，不依赖记录中的星期字段
    const weekday = new Date(`${first}T00:00:00Z`).getUTCDay() || 7;
    // 当前待统计周期起点
    let start = unit === "month" ? `${first.slice(0, 7)}-01` : shiftIsoDate(first, 1 - weekday);
    // 连续周期列表，保留零样本周期
    const periods: DeparturePeriod[] = [];
    while (start <= last) {
        // 下个周期起点，用 UTC 日期处理跨月与跨年
        const date = new Date(`${start}T00:00:00Z`);
        if (unit === "month") date.setUTCMonth(date.getUTCMonth() + 1);
        else date.setUTCDate(date.getUTCDate() + 7);
        // 半开区间的右边界
        const next = date.toISOString().slice(0, 10);
        // 原样复用主卡片的有效出勤和平均值计算口径
        const metrics = calculateWorkloadMetrics(sorted.filter((record) => record.date >= start && record.date < next));
        periods.push({ start, end: shiftIsoDate(next, -1), minute: metrics.averageDepartureMinute, count: metrics.averageDepartureSampleDays });
        start = next;
    }
    return periods;
}

/** 仅提取有真实数据包围的缺口端点，不插值、不延伸首尾空周期 */
export function getDepartureBridges(periods: DeparturePeriod[]): [DeparturePeriod, DeparturePeriod][] {
    // 每个缺口只连接前后两个真实样本
    const bridges: [DeparturePeriod, DeparturePeriod][] = [];
    // 最近一个有效周期的位置
    let previous = -1;
    periods.forEach((period, index) => {
        if (period.minute === null) return;
        if (previous >= 0 && index > previous + 1) bridges.push([periods[previous]!, period]);
        previous = index;
    });
    return bridges;
}

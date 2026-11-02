import { describe, expect, it } from "vitest";
import { calculateDepartureTrend, getDepartureBridges } from "./departure-trend";
import { calculateWorkloadMetrics } from "./workload-evaluation";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import type { AttendanceRecord } from "../types/attendance";

/** 构造真实星期及保留跨夜分钟的完整考勤 */
function record(date: string, endMinute: number | null): AttendanceRecord {
    return { ...ATTENDANCE_RECORD_MOCKS[0]!, date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() || 7, startMinute: 540, endMinute, attendanceState: endMinute === null ? "incomplete" : "complete", overnightState: endMinute !== null && endMinute >= 1440 ? "confirmed" : "none" };
}

describe("全量平均下班趋势", () => {
    it("自然周跨月跨年保持完整，并与主卡片统计口径一致", () => {
        // 同一自然周覆盖跨年，周五和缺失下班不应计入平均
        const records = [record("2026-01-02", 1400), record("2025-12-31", 1500), record("2026-01-01", 1260), record("2025-12-30", null)];
        // 复用卡片算法作为口径基准
        const metrics = calculateWorkloadMetrics(records);
        expect(calculateDepartureTrend(records, "week")).toEqual([{ start: "2025-12-29", end: "2026-01-04", minute: metrics.averageDepartureMinute, count: metrics.averageDepartureSampleDays }]);
        expect(metrics.averageDepartureMinute).toBe(1380);
        expect(metrics.averageDepartureSampleDays).toBe(2);
        expect(calculateDepartureTrend(records, "month").map((period) => period.minute)).toEqual([1500, 1260]);
    });
    it("补齐缺失自然月，空数据和仅周五出勤不产生平均值", () => {
        expect(calculateDepartureTrend([], "week")).toEqual([]);
        // 不连续月份中保留空周期，避免用零点代替无数据
        const periods = calculateDepartureTrend([record("2026-01-01", 1200), record("2026-03-02", 1320)], "month");
        expect(periods.map((period) => period.minute)).toEqual([1200, null, 1320]);
        expect(periods[1]).toEqual({ start: "2026-02-01", end: "2026-02-28", minute: null, count: 0 });
        expect(calculateDepartureTrend([record("2026-01-02", 1200)], "week")[0]?.count).toBe(0);
    });
});

describe("缺失周期的虚线连接", () => {
    it("只连接中间缺口，连续数据及首尾空周期不画虚线", () => {
        // 一月和六月仅周五出勤，中间三月为空，四五月连续有效
        const periods = calculateDepartureTrend([record("2026-01-02", 1200), record("2026-02-02", 1200), record("2026-04-01", 1260), record("2026-05-04", 1300), record("2026-06-05", 1320)], "month");
        expect(getDepartureBridges(periods)).toEqual([[periods[1], periods[3]]]);
        expect(periods[2]?.minute).toBeNull();
        expect(getDepartureBridges([])).toEqual([]);
    });
});

import { describe, expect, it } from "vitest";
import { calculatePressureTrend } from "./pressure-trend";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import type { AttendanceRecord } from "../types/attendance";

/** 构造周末、零压力和待结算边界所需的考勤 */
function attendance(date: string, endMinute: number | null): AttendanceRecord {
    return { ...ATTENDANCE_RECORD_MOCKS[0]!, date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() || 7, startMinute: 540, endMinute, overnightState: "none" };
}

describe("自然周期平均压力", () => {
    it("按日封顶抵扣，保留零压力与周末出勤，排除缺失下班和当天", () => {
        // 周一四分、周二零分、周六六分，共三个已结算考勤日
        const records = [attendance("2026-10-12", 1320), attendance("2026-10-13", 1080), attendance("2026-10-17", 1200), attendance("2026-10-18", null), attendance("2026-10-19", 1380)];
        // 零压力日的多余解压不得抵扣周六压力，无考勤日也不能增加分母
        const entries = ["2026-10-12", "2026-10-13", "2026-10-16"].map((date) => ({ id: date, date, type: "cycling" as const, durationMinutes: 600, createdAt: 0 }));
        // 使用相同三天计算两种压力平均值
        const periods = calculatePressureTrend(records, entries, "2026-10-19", "week");
        expect(periods[0]).toEqual({ start: "2026-10-12", end: "2026-10-18", count: 3, overtime: 10 / 3, final: 2 });
        expect(periods[1]).toEqual({ start: "2026-10-19", end: "2026-10-25", count: 0, overtime: null, final: null });
    });
    it("自然月保留中间缺口，自然周跨年不拆分，空记录不产生曲线", () => {
        // 缺失月份必须保留为无数据而非零压力
        const periods = calculatePressureTrend([attendance("2025-12-31", 1320), attendance("2026-02-02", 1380)], [], "2026-03-01", "month");
        expect(periods.map((period) => period.overtime)).toEqual([4, null, 6]);
        expect(calculatePressureTrend([attendance("2025-12-31", 1320), attendance("2026-01-01", 1380)], [], "2026-03-01", "week")[0]).toMatchObject({ start: "2025-12-29", end: "2026-01-04", overtime: 5, final: 5, count: 2 });
        expect(calculatePressureTrend([], [], "2026-03-01", "month")).toEqual([]);
    });
});

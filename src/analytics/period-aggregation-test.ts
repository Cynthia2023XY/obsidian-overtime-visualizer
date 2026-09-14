import { describe, expect, it } from "vitest";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { aggregateByMonth, aggregateByWeekday } from "./period-aggregation";

describe("周期与星期维度聚合", () => {
  it("按自然月统计样本数和排除数", () => {
    /** 代表性 mock 的月度聚合结果 */
    const periods = aggregateByMonth(ATTENDANCE_RECORD_MOCKS);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ period: "2026-01", sampleCount: 1, excludedCount: 1 });
    expect(periods[1]).toMatchObject({ period: "2026-02", sampleCount: 5, excludedCount: 1 });
  });

  it("对星期维度同时计算平均和中位下班时间", () => {
    /** 代表性 mock 的星期维度聚合结果 */
    const weekdays = aggregateByWeekday(ATTENDANCE_RECORD_MOCKS);
    /** 所有有效周四记录的聚合结果 */
    const thursday = weekdays[3];
    expect(thursday).toMatchObject({ label: "周四", sampleCount: 2, averageEndMinute: 1_380, medianEndMinute: 1_380 });
    expect(weekdays[6]).toMatchObject({ label: "周日", sampleCount: 0, averageEndMinute: null });
  });
});

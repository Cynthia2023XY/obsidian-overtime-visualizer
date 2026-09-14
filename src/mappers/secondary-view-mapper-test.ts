import { describe, expect, it } from "vitest";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { mapAttendanceTableRows, mapCalendarCells } from "./secondary-view-mapper";

describe("次要仪表盘 ViewModel 映射", () => {
  it("为月度日历生成完整日期并标记上线、请假和周末出勤", () => {
    /** 代表性 mock 对应的二月日历热力单元格 */
    const cells = mapCalendarCells(ATTENDANCE_RECORD_MOCKS, "2026-02");
    expect(cells).toHaveLength(28);
    expect(cells[4]).toMatchObject({ date: "2026-02-05", modifier: "release" });
    expect(cells[6]).toMatchObject({ date: "2026-02-07", modifier: "weekend-work" });
    expect(cells[11]).toMatchObject({ date: "2026-02-12", modifier: "leave", intensity: 0 });
  });

  it("为数据表按日期倒序显示跨夜和待修正状态", () => {
    /** 代表性 mock 对应的数据表行 */
    const rows = mapAttendanceTableRows(ATTENDANCE_RECORD_MOCKS);
    /** 数据表中的跨夜记录行 */
    const overnightRow = rows.find((row) => row.date === "2026-01-22");
    /** 数据表中的跨夜次日歧义记录行 */
    const ambiguousRow = rows.find((row) => row.date === "2026-01-23");
    expect(rows[0]?.date).toBe("2026-02-12");
    expect(overnightRow).toMatchObject({ end: "次日 00:01", state: "跨夜" });
    expect(ambiguousRow).toMatchObject({ duration: "—", state: "起始待修正" });
  });
});

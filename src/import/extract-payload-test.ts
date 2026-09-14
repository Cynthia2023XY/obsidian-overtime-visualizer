import { describe, expect, it } from "vitest";
import { extractAttendanceList, parseAttendanceJson } from "./extract-payload";

describe("HR JSON 解包", () => {
  it("支持完整响应、list 包装和直接数组", () => {
    /** 用于验证解包的单条原始数据 */
    const item = { attendanceDay: "2026.01.01" };
    expect(extractAttendanceList({ body: { list: [item] } })).toEqual([item]);
    expect(extractAttendanceList({ list: [item] })).toEqual([item]);
    expect(extractAttendanceList([item])).toEqual([item]);
  });

  it("对无效 JSON 和缺少列表的对象返回可读错误", () => {
    expect(() => parseAttendanceJson("{")) .toThrow("JSON 格式无效");
    expect(() => extractAttendanceList({ success: true })).toThrow("未找到考勤数组");
  });

  it("合并 Markdown 中多个非空 JSON 代码块并忽略空代码块", () => {
    /** 模拟跨月考勤笔记的 Markdown 文本 */
    const markdown = [
      "# 考勤原始数据",
      "```json",
      JSON.stringify({ body: { list: [{ attendanceDay: "2025.12.31" }] } }),
      "```",
      "说明文字",
      "```JSON",
      JSON.stringify({ list: [{ attendanceDay: "2026.01.01" }] }),
      "```",
      "```json",
      "",
      "```",
    ].join("\n");

    expect(parseAttendanceJson(markdown)).toEqual([
      { attendanceDay: "2025.12.31" },
      { attendanceDay: "2026.01.01" },
    ]);
  });
});

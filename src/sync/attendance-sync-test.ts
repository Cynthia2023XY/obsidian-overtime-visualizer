import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { prepareAttendanceImport } from "../import/import-service";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import { importSyncPayload } from "./attendance-sync";

/** 构造无需真实个人信息的自动抓取快照 */
function snapshot(list: unknown[], total = list.length): string {
  return JSON.stringify({ schemaVersion: 1, complete: true, capturedAt: "2026-10-29T01:00:00Z", startDate: "2026-10-01", endDate: "2026-10-29", total, list });
}

/** 代表一条已完成打卡的脱敏考勤 */
const item = { attendanceDay: "2026.10.21", attendanceStartTime: "09:00:00", attendanceEndTime: "21:00:00", workDayType: "工作日", applyReason: "正常" };

describe("考勤自动导入", () => {
  it("新增、重复导入与人工修改保护沿用插件的导入规则", async () => {
    // 以真实解析结果作为当前数据，验证重复和人工修改的处理
    const record = prepareAttendanceImport([item], [], DEFAULT_SETTINGS).recordsToWrite[0]!;
    let records = [] as typeof record[];
    const importBatch = vi.fn(async (next: typeof record[]) => { records = next; });
    const repository = { list: () => records, getSettings: () => DEFAULT_SETTINGS, importBatch } as unknown as PluginDataRepository;
    expect(await importSyncPayload(snapshot([item]), repository)).toEqual({ create: 1, update: 0, skip: 0 });
    expect(await importSyncPayload(snapshot([item]), repository)).toEqual({ create: 0, update: 0, skip: 1 });
    records = [{ ...record, manuallyEdited: true }];
    expect(await importSyncPayload(snapshot([{ ...item, attendanceEndTime: "22:00:00" }]), repository)).toEqual({ create: 0, update: 0, skip: 1 });
    expect(importBatch).toHaveBeenCalledTimes(1);
  });

  it("拒绝不完整、超出区间或无效的响应且不写入", async () => {
    // 无效输入不能产生任何导入批次
    const importBatch = vi.fn();
    const repository = { list: () => [], getSettings: () => DEFAULT_SETTINGS, importBatch } as unknown as PluginDataRepository;
    await expect(importSyncPayload(snapshot([item], 2), repository)).rejects.toThrow("不完整");
    await expect(importSyncPayload(snapshot([{ ...item, attendanceDay: "2026.09.30" }]), repository)).rejects.toThrow("日期范围");
    await expect(importSyncPayload(snapshot([{ ...item, attendanceDay: "无效" }]), repository)).rejects.toThrow("错误");
    expect(importBatch).not.toHaveBeenCalled();
  });
});

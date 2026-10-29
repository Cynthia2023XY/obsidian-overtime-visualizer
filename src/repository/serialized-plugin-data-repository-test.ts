import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { prepareAttendanceImport } from "../import/import-service";
import { SerializedPluginDataRepository } from "./serialized-plugin-data-repository";

/** 代表需要保护的手动修改记录 */
const item = { attendanceDay: "2026.10.21", attendanceStartTime: "09:00:00", attendanceEndTime: "21:00:00", workDayType: "工作日", applyReason: "正常" };

describe("考勤仓储并发写入", () => {
  it("等待手动修改完成后再计算自动同步，保留人工记录", async () => {
    // 在持久化过程中暂停手动写入，复现后台同步同时到达
    let unblock = (): void => {};
    let signalStarted = (): void => {};
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const saveData = vi.fn(async () => { signalStarted(); await gate; });
    const repository = new SerializedPluginDataRepository({ loadData: async () => null, saveData }, { loadReliefData: async () => null, saveReliefData: async () => {} });
    await repository.initialize();
    // 使用实际解析器构造一条已人工修正的考勤
    const record = { ...prepareAttendanceImport([item], [], DEFAULT_SETTINGS).recordsToWrite[0]!, manuallyEdited: true };
    const manualWrite = repository.upsert(record);
    await started;
    const content = JSON.stringify({ schemaVersion: 1, complete: true, capturedAt: "2026-10-29T01:00:00Z", startDate: "2026-10-21", endDate: "2026-10-21", total: 1, list: [{ ...item, attendanceEndTime: "22:00:00" }] });
    const automaticWrite = repository.importAttendanceSync(content);
    unblock();
    await manualWrite;
    expect(await automaticWrite).toEqual({ create: 0, update: 0, skip: 1 });
    expect(repository.get("2026-10-21")).toMatchObject({ manuallyEdited: true, endMinute: record.endMinute });
    expect(saveData).toHaveBeenCalledTimes(1);
  });

  it("一次写入失败后后续操作仍能继续", async () => {
    // 首次保存失败不能让后续队列永久停滞
    const saveData = vi.fn().mockRejectedValueOnce(new Error("写入失败")).mockResolvedValue(undefined);
    const repository = new SerializedPluginDataRepository({ loadData: async () => null, saveData }, { loadReliefData: async () => null, saveReliefData: async () => {} });
    await repository.initialize();
    const record = prepareAttendanceImport([item], [], DEFAULT_SETTINGS).recordsToWrite[0]!;
    await expect(repository.upsert(record)).rejects.toThrow("写入失败");
    await repository.upsert(record);
    expect(repository.get(record.date)).not.toBeNull();
  });
});

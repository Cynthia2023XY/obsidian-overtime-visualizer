import { describe, expect, it, vi } from "vitest";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import type { OvertimeVisualizerData, PluginDataAdapter } from "../types/storage";
import { PluginDataRepository } from "./plugin-data-repository";

/** 创建可在测试中查看持久化结果的内存适配器 */
function createMemoryAdapter(initialData: unknown = null): PluginDataAdapter & { savedData: OvertimeVisualizerData | null } {
  /** 内存适配器当前保存的插件数据 */
  const adapter: PluginDataAdapter & { savedData: OvertimeVisualizerData | null } = {
    savedData: null,
    loadData: async () => initialData,
    saveData: async (data) => { adapter.savedData = data; },
  };
  return adapter;
}

describe("版本化考勤仓储", () => {
  it("初次加载时创建空数据并支持查询", async () => {
    /** 未保存过数据的内存适配器 */
    const adapter = createMemoryAdapter();
    /** 待验证的版本化考勤仓储 */
    const repository = new PluginDataRepository(adapter, () => 100);
    await repository.initialize();
    await repository.upsert(ATTENDANCE_RECORD_MOCKS[0]!);

    expect(repository.list({ releaseOnly: true })).toHaveLength(1);
    expect(repository.getSettings().endBenchmarkMinute).toBe(21 * 60);
    expect(adapter.savedData?.schemaVersion).toBe(1);
    expect(adapter.savedData?.snapshots).toHaveLength(1);
  });

  it("导入批次可同时撤销新建和覆盖", async () => {
    /** 用于验证导入恢复的内存适配器 */
    const adapter = createMemoryAdapter();
    /** 待验证的版本化考勤仓储 */
    const repository = new PluginDataRepository(adapter, () => 200);
    await repository.initialize();
    await repository.upsert(ATTENDANCE_RECORD_MOCKS[0]!);
    /** 将已有日改成非上线日的更新记录 */
    const updatedRecord = { ...ATTENDANCE_RECORD_MOCKS[0]!, isReleaseDay: false };
    /** 同时包含更新和新建的导入批次 */
    const batch = await repository.importBatch([updatedRecord, ATTENDANCE_RECORD_MOCKS[1]!]);
    expect(repository.list()).toHaveLength(2);
    await repository.restoreBatch(batch.id);
    expect(repository.list()).toHaveLength(1);
    expect(repository.get(updatedRecord.date)?.isReleaseDay).toBe(true);
  });

  it("持久化失败时不污染已加载的内存状态", async () => {
    /** 持久化时始终失败的适配器 */
    const adapter: PluginDataAdapter = { loadData: async () => null, saveData: vi.fn(async () => { throw new Error("磁盘写入失败"); }) };
    /** 待验证原子写入的版本化仓储 */
    const repository = new PluginDataRepository(adapter);
    await repository.initialize();

    await expect(repository.upsert(ATTENDANCE_RECORD_MOCKS[0]!)).rejects.toThrow("磁盘写入失败");
    expect(repository.list()).toHaveLength(0);
  });
});

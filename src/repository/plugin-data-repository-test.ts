import { describe, expect, it, vi } from "vitest";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import type { OvertimeVisualizerData, PluginDataAdapter, ReliefDataAdapter, ReliefVisualizerData } from "../types/storage";
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

/** 创建可在测试中查看独立解压文件的内存适配器 */
function createReliefMemoryAdapter(initialData: unknown = null): ReliefDataAdapter & { savedReliefData: ReliefVisualizerData | null } {
  /** 内存中当前保存的解压数据 */
  const adapter: ReliefDataAdapter & { savedReliefData: ReliefVisualizerData | null } = {
    savedReliefData: null,
    loadReliefData: async () => initialData,
    saveReliefData: async (data) => { adapter.savedReliefData = data; },
  };
  return adapter;
}

describe("版本化考勤仓储", () => {
  it("初次加载时创建空数据并支持查询", async () => {
    /** 未保存过数据的内存适配器 */
    const adapter = createMemoryAdapter();
    /** 待验证的版本化考勤仓储 */
    const repository = new PluginDataRepository(adapter, createReliefMemoryAdapter(), () => 100);
    await repository.initialize();
    await repository.upsert(ATTENDANCE_RECORD_MOCKS[0]!);

    expect(repository.list({ releaseOnly: true })).toHaveLength(1);
    expect(repository.getSettings().endBenchmarkMinute).toBe(21 * 60);
    expect(adapter.savedData?.schemaVersion).toBe(3);
    expect(adapter.savedData?.snapshots).toHaveLength(1);
  });

  it("导入批次可同时撤销新建和覆盖", async () => {
    /** 用于验证导入恢复的内存适配器 */
    const adapter = createMemoryAdapter();
    /** 待验证的版本化考勤仓储 */
    const repository = new PluginDataRepository(adapter, createReliefMemoryAdapter(), () => 200);
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
    const repository = new PluginDataRepository(adapter, createReliefMemoryAdapter());
    await repository.initialize();

    await expect(repository.upsert(ATTENDANCE_RECORD_MOCKS[0]!)).rejects.toThrow("磁盘写入失败");
    expect(repository.list()).toHaveLength(0);
  });

  it("可独立保存、查询和撤销当日解压明细", async () => {
    /** 用于验证解压记录持久化的内存适配器 */
    const adapter = createMemoryAdapter();
    /** 用于验证解压文件内容的独立内存适配器 */
    const reliefAdapter = createReliefMemoryAdapter();
    /** 使用稳定时间的本地仓储 */
    const repository = new PluginDataRepository(adapter, reliefAdapter, () => 300);
    await repository.initialize();
    /** 新增后可用于撤销的解压记录 */
    const entry = await repository.addReliefEntry("2026-09-16", "walk", 15);
    expect(repository.listReliefEntries("2026-09-16", "2026-09-16")).toHaveLength(1);
    expect(reliefAdapter.savedReliefData?.entries[entry.id]?.durationMinutes).toBe(15);
    await repository.deleteReliefEntry(entry.id);
    expect(repository.listReliefEntries()).toHaveLength(0);
  });

  it("首次加载时将旧版解压记录搬迁到独立文件", async () => {
    /** 含一条历史解压记录的版本二主数据 */
    const legacyData = {
      schemaVersion: 2,
      settings: {},
      records: {},
      importBatches: [],
      snapshots: [],
      reliefEntries: {
        "relief-old": { id: "relief-old", date: "2026-09-16", type: "walk", durationMinutes: 15, createdAt: 100 },
      },
    };
    /** 用于验证主数据清理结果的内存适配器 */
    const adapter = createMemoryAdapter(legacyData);
    /** 用于验证历史记录搬迁结果的解压适配器 */
    const reliefAdapter = createReliefMemoryAdapter();
    /** 执行旧数据自动搬迁的本地仓储 */
    const repository = new PluginDataRepository(adapter, reliefAdapter, () => 400);
    await repository.initialize();

    expect(repository.listReliefEntries()).toHaveLength(1);
    expect(reliefAdapter.savedReliefData?.entries["relief-old"]?.type).toBe("walk");
    expect(adapter.savedData?.schemaVersion).toBe(3);
    expect(adapter.savedData).not.toHaveProperty("reliefEntries");
  });
});

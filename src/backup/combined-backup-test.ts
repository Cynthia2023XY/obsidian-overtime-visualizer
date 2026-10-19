import type { App } from "obsidian";
import { ImportPreviewModal } from "../ui/import-preview-modal";
import type { CombinedBackup } from "./combined-backup";
import { describe, expect, it, vi } from "vitest";
import { createCombinedBackup, importCombinedBackup, parseCombinedBackup } from "./combined-backup";
import { PluginDataRepository } from "../repository/plugin-data-repository";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import type { OvertimeVisualizerData, ReliefVisualizerData } from "../types/storage";

/** 弹窗测试仅替换宿主基类和提示，实际预览与确认导入逻辑仍运行 */
vi.mock("obsidian", () => ({ Modal: vi.fn(), Notice: vi.fn() }));

/** 创建可重新加载的隔离仓储，失败用例可精确控制两类文件写入 */
async function createStore() {
    // 模拟考勤数据与配置的独立持久化文件
    let attendance: OvertimeVisualizerData | null = null;
    // 模拟解压明细独立文件
    let relief: ReliefVisualizerData | null = null;
    // 保留写入边界以测试第二个文件失败时的恢复行为
    const adapter = { loadData: () => Promise.resolve(attendance), saveData: vi.fn(async (data: OvertimeVisualizerData) => { attendance = structuredClone(data); }) };
    // 解压文件写入失败不改变已保存的数据
    const reliefAdapter = { loadReliefData: () => Promise.resolve(relief), saveReliefData: vi.fn(async (data: ReliefVisualizerData) => { relief = structuredClone(data); }) };
    // 使用真实仓储验证合并、幂等与失败恢复，不重复实现业务规则
    const repository = new PluginDataRepository(adapter, reliefAdapter);
    await repository.initialize();
    return { repository, adapter, reliefAdapter };
}

/** 准备含人工修正和自定义解压名称、分值的完整备份 */
async function createBackup() {
    // 导出来源使用真实仓储 API 保存数据
    const { repository } = await createStore();
    await repository.upsert({ ...ATTENDANCE_RECORD_MOCKS[0]!, manuallyEdited: true });
    await repository.addReliefEntry("2026-10-18", "sanlian", 30);
    // 改名和修改分值后也要随数据一起恢复
    const settings = repository.getSettings();
    settings.reliefActivities[0]!.name = "自定义阅读";
    settings.reliefActivities[0]!.score = 3.5;
    await repository.updateSettings(settings);
    return createCombinedBackup(repository);
}

describe("考勤与解压合并备份", () => {
    it("现有导入弹窗自动识别合并文件，预览不写入，确认后同时恢复两类数据", async () => {
        // 用户选择的合并文件
        const backup = await createBackup();
        // 导入目的仓储和界面刷新回调
        const { repository, adapter, reliefAdapter } = await createStore();
        // 确认完成后重新渲染看板
        const onImported = vi.fn();
        // 保留真实弹窗方法，只替换依赖宿主 DOM 的渲染和关闭边界
        const modal = new ImportPreviewModal({} as App, repository, onImported) as unknown as {
            sourceText: string;
            parsePreview(): void;
            commitImport(): Promise<void>;
            renderCombinedPreview(backup: CombinedBackup): void;
            close(): void;
        };
        // 跟踪预览渲染而不依赖真实 Obsidian 弹窗节点
        const renderPreview = vi.spyOn(modal, "renderCombinedPreview").mockImplementation(() => undefined);
        // 跟踪成功后关闭行为
        const close = vi.fn();
        modal.close = close;
        adapter.saveData.mockClear();
        reliefAdapter.saveReliefData.mockClear();
        modal.sourceText = JSON.stringify(backup);
        modal.parsePreview();
        expect(renderPreview).toHaveBeenCalledWith(backup);
        expect(adapter.saveData).not.toHaveBeenCalled();
        expect(reliefAdapter.saveReliefData).not.toHaveBeenCalled();
        await modal.commitImport();
        expect(repository.list()).toEqual(backup.attendance);
        expect(repository.listReliefEntries()).toEqual(backup.relief);
        expect(onImported).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });
    it("一个文件往返恢复完整考勤、人工修正标记、无考勤日解压与自定义配置", async () => {
        // 用户导出的合并 JSON
        const backup = await createBackup();
        // 新环境不含任何考勤或解压数据
        const { repository, adapter, reliefAdapter } = await createStore();
        await importCombinedBackup(repository, parseCombinedBackup(JSON.stringify(backup))!);
        // 重新加载后仍应保持全部业务事实和设置
        const reloaded = new PluginDataRepository(adapter, reliefAdapter);
        await reloaded.initialize();
        expect(reloaded.list()).toEqual(backup.attendance);
        expect(reloaded.listReliefEntries()).toEqual(backup.relief);
        expect(reloaded.getSettings()).toEqual({ ...backup.settings, reliefActivities: backup.settings.reliefActivities.map((activity) => ({ ...activity, enabled: activity.enabled ?? true })) });
        expect(reloaded.list()[0]!.manuallyEdited).toBe(true);
    });

    it("重复导入按日期和 ID 合并，保留备份之外的已有数据", async () => {
        // 需要恢复的两类记录
        const backup = await createBackup();
        // 原有数据不可被整体替换
        const { repository } = await createStore();
        await repository.upsert({ ...ATTENDANCE_RECORD_MOCKS[0]!, date: "2020-01-01" });
        await repository.addReliefEntry("2020-01-01", "walk", 15);
        await importCombinedBackup(repository, backup);
        await importCombinedBackup(repository, backup);
        expect(repository.list()).toHaveLength(2);
        expect(repository.listReliefEntries()).toHaveLength(2);
        expect(repository.get("2020-01-01")).not.toBeNull();
    });

    it("第二类数据写入失败时恢复原考勤和设置，不留下部分导入", async () => {
        // 即将导入的考勤和不同配置
        const backup = await createBackup();
        // 本地已有同日期考勤用于验证覆盖后恢复
        const { repository, reliefAdapter } = await createStore();
        await repository.upsert({ ...backup.attendance[0]!, manuallyEdited: false });
        // 导入前应完整保留的业务状态
        const original = createCombinedBackup(repository);
        reliefAdapter.saveReliefData.mockRejectedValueOnce(new Error("磁盘写入失败"));
        await expect(importCombinedBackup(repository, backup)).rejects.toThrow("已恢复原考勤和配置");
        expect(repository.list()).toEqual(original.attendance);
        expect(repository.listReliefEntries()).toEqual(original.relief);
        expect(repository.getSettings()).toEqual(original.settings);
    });

    it("无效日期、无效配置、未知版本与重复 ID 均在写入前拒绝", async () => {
        // 有效备份作为损坏边界的基础样本
        const backup = await createBackup();
        expect(() => parseCombinedBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow("版本");
        expect(() => parseCombinedBackup(JSON.stringify({ ...backup, relief: [{ ...backup.relief[0], date: "2026-02-30" }] }))).toThrow("无效");
        expect(() => parseCombinedBackup(JSON.stringify({ ...backup, relief: [backup.relief[0], backup.relief[0]] }))).toThrow("重复");
        expect(() => parseCombinedBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, endBenchmarkMinute: -1 } }))).toThrow("无效");
        // 直接调用导入服务也不能绕过完整性校验
        const { repository, adapter } = await createStore();
        adapter.saveData.mockClear();
        await expect(importCombinedBackup(repository, { ...backup, attendance: [{ ...backup.attendance[0]!, startMinute: -1 }] })).rejects.toThrow("无效");
        expect(adapter.saveData).not.toHaveBeenCalled();
    });

    it("只有一种记录或空备份也能往返，旧考勤与 Markdown 继续使用原导入流程", async () => {
        // 空仓储的合法备份不应被判为损坏
        const { repository } = await createStore();
        expect(parseCombinedBackup(JSON.stringify(createCombinedBackup(repository)))?.attendance).toEqual([]);
        // 仅解压备份依然携带配置和完整解压明细
        const backup = await createBackup();
        backup.attendance = [];
        await importCombinedBackup(repository, backup);
        expect(repository.list()).toEqual([]);
        expect(repository.listReliefEntries()).toEqual(backup.relief);
        expect(parseCombinedBackup(JSON.stringify({ body: { list: [] } }))).toBeNull();
        expect(parseCombinedBackup("```json\n{}\n```" )).toBeNull();
    });
});

import { PluginDataRepository } from "./plugin-data-repository";
import { importSyncPayload } from "../sync/attendance-sync";

/** 将考勤、配置与解压数据的写入顺序化，避免后台同步覆盖进行中的操作 */
export class SerializedPluginDataRepository extends PluginDataRepository {
  /** 上一项写入完成后才允许执行后续操作 */
  private pendingWrite: Promise<void> = Promise.resolve();

  /** 将操作加入写入队列，失败后仍允许后续操作继续 */
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    // 保留当前操作自己的结果，同时让队列在失败后恢复
    const result = this.pendingWrite.then(action);
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  /** 按最新状态更新统计配置 */
  override updateSettings(...args: Parameters<PluginDataRepository["updateSettings"]>): ReturnType<PluginDataRepository["updateSettings"]> { return this.enqueue(() => super.updateSettings(...args)); }

  /** 顺序写入手动考勤修改 */
  override upsert(...args: Parameters<PluginDataRepository["upsert"]>): ReturnType<PluginDataRepository["upsert"]> { return this.enqueue(() => super.upsert(...args)); }

  /** 顺序删除考勤记录 */
  override delete(...args: Parameters<PluginDataRepository["delete"]>): ReturnType<PluginDataRepository["delete"]> { return this.enqueue(() => super.delete(...args)); }

  /** 顺序写入手动导入批次 */
  override importBatch(...args: Parameters<PluginDataRepository["importBatch"]>): ReturnType<PluginDataRepository["importBatch"]> { return this.enqueue(() => super.importBatch(...args)); }

  /** 顺序撤销已有导入批次 */
  override restoreBatch(...args: Parameters<PluginDataRepository["restoreBatch"]>): ReturnType<PluginDataRepository["restoreBatch"]> { return this.enqueue(() => super.restoreBatch(...args)); }

  /** 顺序新增解压记录 */
  override addReliefEntry(...args: Parameters<PluginDataRepository["addReliefEntry"]>): ReturnType<PluginDataRepository["addReliefEntry"]> { return this.enqueue(() => super.addReliefEntry(...args)); }

  /** 顺序删除解压记录 */
  override deleteReliefEntry(...args: Parameters<PluginDataRepository["deleteReliefEntry"]>): ReturnType<PluginDataRepository["deleteReliefEntry"]> { return this.enqueue(() => super.deleteReliefEntry(...args)); }

  /** 顺序更新解压记录 */
  override updateReliefEntry(...args: Parameters<PluginDataRepository["updateReliefEntry"]>): ReturnType<PluginDataRepository["updateReliefEntry"]> { return this.enqueue(() => super.updateReliefEntry(...args)); }

  /** 顺序合并解压记录 */
  override importReliefEntries(...args: Parameters<PluginDataRepository["importReliefEntries"]>): ReturnType<PluginDataRepository["importReliefEntries"]> { return this.enqueue(() => super.importReliefEntries(...args)); }

  /** 在写入队列中使用最新数据计算并提交自动同步批次 */
  importAttendanceSync(content: string): Promise<{ create: number; update: number; skip: number }> {
    return this.enqueue(() => importSyncPayload(content, {
      list: (query) => this.list(query),
      getSettings: () => this.getSettings(),
      importBatch: (records) => super.importBatch(records),
    }));
  }
}

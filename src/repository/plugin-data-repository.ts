import type { AttendanceRecord } from "../types/attendance";
import type { OvertimeVisualizerSettings } from "../settings";
import type { AttendanceQuery, ImportBatch, OvertimeVisualizerData, PluginDataAdapter, PluginDataSnapshot } from "../types/storage";
import { migratePluginData } from "./migrations";

/** 深拷贝可 JSON 序列化的插件数据，防止写入失败时污染内存状态 */
function cloneData(data: OvertimeVisualizerData): OvertimeVisualizerData {
  return JSON.parse(JSON.stringify(data)) as OvertimeVisualizerData;
}

/** 判断单条考勤记录是否符合本地查询 */
function matchesQuery(record: AttendanceRecord, query: AttendanceQuery): boolean {
  if (query.startDate && record.date < query.startDate) return false;
  if (query.endDate && record.date > query.endDate) return false;
  if (query.dayTypes && !query.dayTypes.includes(record.dayType)) return false;
  if (query.attendanceStates && !query.attendanceStates.includes(record.attendanceState)) return false;
  if (query.releaseOnly && !record.isReleaseDay) return false;
  if (query.overnightOnly && record.overnightState !== "linked" && record.overnightState !== "confirmed") return false;
  return true;
}

/** 管理 Obsidian data.json 中考勤数据、导入批次和有限快照的仓储 */
export class PluginDataRepository {
  /** 已加载并通过版本校验的内存数据 */
  private data: OvertimeVisualizerData | null = null;

  /** 创建仓储并注入 Obsidian 持久化能力 */
  constructor(
    private readonly adapter: PluginDataAdapter,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 加载并迁移本地数据 */
  async initialize(): Promise<void> {
    this.data = migratePluginData(await this.adapter.loadData());
  }

  /** 按日期倒序查询规范化考勤记录 */
  list(query: AttendanceQuery = {}): AttendanceRecord[] {
    return Object.values(this.requireData().records).filter((record) => matchesQuery(record, query)).sort((left, right) => right.date.localeCompare(left.date));
  }

  /** 根据日期读取单条考勤记录 */
  get(date: string): AttendanceRecord | null {
    return this.requireData().records[date] ?? null;
  }

  /** 读取不与仓储内部状态共享引用的统计设置 */
  getSettings(): OvertimeVisualizerSettings {
    return cloneData(this.requireData()).settings;
  }

  /** 写入一条考勤记录并在成功后替换内存状态 */
  async upsert(record: AttendanceRecord): Promise<void> {
    /** 不影响当前内存状态的待写入副本 */
    const nextData = this.createWritableCopy();
    nextData.records[record.date] = record;
    await this.commit(nextData);
  }

  /** 删除指定日期的考勤记录并保留写入前快照 */
  async delete(date: string): Promise<boolean> {
    if (!this.requireData().records[date]) return false;
    /** 不影响当前内存状态的待写入副本 */
    const nextData = this.createWritableCopy();
    delete nextData.records[date];
    await this.commit(nextData);
    return true;
  }

  /** 原子写入一批预览通过的考勤记录并返回可回滚批次 */
  async importBatch(records: AttendanceRecord[]): Promise<ImportBatch> {
    /** 不影响当前内存状态的待写入副本 */
    const nextData = this.createWritableCopy();
    /** 本批导入的唯一标识 */
    const batchId = `import-${this.now()}`;
    /** 本批导入新建的日期 */
    const createdDates: string[] = [];
    /** 本批导入覆盖前的旧记录 */
    const updatedRecords: Record<string, AttendanceRecord> = {};
    records.forEach((record) => {
      /** 相同日期的已有记录 */
      const existingRecord = nextData.records[record.date];
      if (existingRecord) updatedRecords[record.date] = existingRecord;
      else createdDates.push(record.date);
      nextData.records[record.date] = record;
    });
    /** 记录本批差异以便后续回滚的导入批次 */
    const batch: ImportBatch = { id: batchId, importedAt: this.now(), createdDates, updatedRecords };
    nextData.importBatches.push(batch);
    await this.commit(nextData);
    return batch;
  }

  /** 撤销指定导入批次新建和覆盖的记录 */
  async restoreBatch(batchId: string): Promise<boolean> {
    /** 需要撤销的导入批次 */
    const batch = this.requireData().importBatches.find((item) => item.id === batchId);
    if (!batch) return false;
    /** 不影响当前内存状态的待恢复副本 */
    const nextData = this.createWritableCopy();
    batch.createdDates.forEach((date) => delete nextData.records[date]);
    Object.entries(batch.updatedRecords).forEach(([date, record]) => { nextData.records[date] = record; });
    nextData.importBatches = nextData.importBatches.filter((item) => item.id !== batchId);
    await this.commit(nextData);
    return true;
  }

  /** 返回已初始化的仓储数据，未初始化时阻断调用 */
  private requireData(): OvertimeVisualizerData {
    if (!this.data) throw new Error("考勤仓储尚未初始化");
    return this.data;
  }

  /** 创建带最多三份写入前快照的可写副本 */
  private createWritableCopy(): OvertimeVisualizerData {
    /** 当前持久化数据 */
    const currentData = this.requireData();
    /** 当前写入前的可恢复快照 */
    const snapshot: PluginDataSnapshot = { createdAt: this.now(), settings: cloneData(currentData).settings, records: cloneData(currentData).records };
    /** 不与当前内存状态共享引用的副本 */
    const nextData = cloneData(currentData);
    nextData.snapshots = [...nextData.snapshots, snapshot].slice(-3);
    return nextData;
  }

  /** 先持久化完整副本，成功后再替换内存数据 */
  private async commit(nextData: OvertimeVisualizerData): Promise<void> {
    await this.adapter.saveData(nextData);
    this.data = nextData;
  }
}

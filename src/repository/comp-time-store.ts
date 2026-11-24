import {
  calculateExtendedExpiryDate,
  calculateInitialExpiryDate,
  createEmptyCompTimeData,
  normalizeHalfHour,
} from "../analytics/comp-time";
import type {
  CompTimeData,
  CompTimeDataAdapter,
  CompTimeLedgerEntry,
  CompTimeSourceType,
  CompTimeSpecialDate,
  CompTimeUsageEntry,
} from "../types/comp-time";

/** 判断未知值是否为可安全读取的普通对象 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验 YYYY-MM-DD 日期字符串是否有效 */
function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** 生成本地唯一记录标识 */
function createUniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 规范化单条使用明细，过滤无效记录 */
function normalizeUsageEntry(raw: unknown): CompTimeUsageEntry | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.usedHours !== "number" || !Number.isFinite(raw.usedHours) || raw.usedHours <= 0) return null;
  if (!isValidIsoDate(raw.usedDate)) return null;
  return {
    id: raw.id,
    usedHours: normalizeHalfHour(raw.usedHours),
    usedDate: raw.usedDate,
    note: typeof raw.note === "string" ? raw.note : "",
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

/** 规范化单条台账记录，保证旧数据或异常字段不会破坏页面 */
function normalizeLedgerEntry(raw: unknown): CompTimeLedgerEntry | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (!isValidIsoDate(raw.date)) return null;
  if (typeof raw.hours !== "number" || !Number.isFinite(raw.hours) || raw.hours <= 0) return null;
  /** 合法来源类型 */
  const sourceType: CompTimeSourceType = (
    raw.sourceType === "workday"
    || raw.sourceType === "rest-day"
    || raw.sourceType === "holiday"
    || raw.sourceType === "special-date"
    || raw.sourceType === "manual"
  )
    ? raw.sourceType
    : "manual";
  /** 初始有效期截止日 */
  const initialExpiresAt = isValidIsoDate(raw.initialExpiresAt) ? raw.initialExpiresAt : calculateInitialExpiryDate(raw.date);
  /** 当前有效截止日 */
  const expiresAt = isValidIsoDate(raw.expiresAt) ? raw.expiresAt : initialExpiresAt;
  /** 清洗后的使用明细列表 */
  const usages = Array.isArray(raw.usages)
    ? raw.usages.map(normalizeUsageEntry).filter((item): item is CompTimeUsageEntry => item !== null)
    : [];

  return {
    id: raw.id,
    date: raw.date,
    sourceType,
    hours: normalizeHalfHour(raw.hours),
    initialExpiresAt,
    expiresAt,
    extended: raw.extended === true,
    extendedAt: typeof raw.extendedAt === "number" && Number.isFinite(raw.extendedAt) ? raw.extendedAt : undefined,
    usages,
    submittedAt: typeof raw.submittedAt === "number" && Number.isFinite(raw.submittedAt) ? raw.submittedAt : 0,
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

/** 从磁盘原始对象清洗出安全的调休持久化数据 */
export function sanitizeCompTimeData(raw: unknown): CompTimeData {
  if (!isPlainObject(raw)) return createEmptyCompTimeData();

  /** 清洗公司公示的特殊日期列表 */
  const specialDates: CompTimeSpecialDate[] = Array.isArray(raw.specialDates)
    ? raw.specialDates
        .filter((item): item is Record<string, unknown> => isPlainObject(item) && isValidIsoDate(item.date))
        .map((item) => ({ date: item.date as string, note: typeof item.note === "string" ? item.note : "" }))
    : [];

  /** 清洗忽略日期列表 */
  const ignoredDates: string[] = Array.isArray(raw.ignoredDates)
    ? [...new Set(raw.ignoredDates.filter(isValidIsoDate))]
    : [];

  /** 清洗草稿微调小时数映射 */
  const draftHourOverrides: Record<string, number> = {};
  if (isPlainObject(raw.draftHourOverrides)) {
    Object.entries(raw.draftHourOverrides).forEach(([date, hours]) => {
      if (isValidIsoDate(date) && typeof hours === "number" && Number.isFinite(hours) && hours >= 0) {
        draftHourOverrides[date] = normalizeHalfHour(hours);
      }
    });
  }

  /** 加班事项仅保留有效日期和文本，旧数据缺少该字段时默认为空 */
  const overtimeNotes: Record<string, string> = {};
  if (isPlainObject(raw.overtimeNotes)) {
    Object.entries(raw.overtimeNotes).forEach(([date, note]) => {
      if (isValidIsoDate(date) && typeof note === "string" && note.trim()) overtimeNotes[date] = note;
    });
  }

  /** 清洗台账条目 */
  const entries: Record<string, CompTimeLedgerEntry> = {};
  if (isPlainObject(raw.entries)) {
    Object.entries(raw.entries).forEach(([id, item]) => {
      if (["__proto__", "constructor", "prototype"].includes(id)) return;
      /** 规范化后的台账对象 */
      const normalized = normalizeLedgerEntry(item);
      if (normalized) entries[normalized.id] = normalized;
    });
  }

  return {
    schemaVersion: 1,
    specialDates,
    ignoredDates,
    draftHourOverrides,
    overtimeNotes,
    entries,
  };
}

/** 创建仅在内存中运行的默认调休适配器，便于测试和无磁盘环境降级 */
export function createMemoryCompTimeAdapter(): CompTimeDataAdapter {
  /** 内存快照 */
  let memory: CompTimeData = createEmptyCompTimeData();
  return {
    loadCompTimeData: () => Promise.resolve(memory),
    saveCompTimeData: (data) => {
      memory = JSON.parse(JSON.stringify(data)) as CompTimeData;
      return Promise.resolve();
    },
  };
}

/** 管理调休统计本地数据的串行化仓储 */
export class CompTimeStore {
  /** 当前内存中的调休持久化数据 */
  private data: CompTimeData = createEmptyCompTimeData();

  /** 串行化写入队列，避免并发保存互相覆盖 */
  private pendingWrite: Promise<void> = Promise.resolve();

  /** 创建调休仓储并注入本地文件读写适配器 */
  constructor(private readonly adapter: CompTimeDataAdapter = createMemoryCompTimeAdapter()) {}

  /** 初始化并加载本地调休数据 */
  async initialize(): Promise<void> {
    try {
      /** 从适配器读取的原始持久化数据 */
      const raw = await this.adapter.loadCompTimeData();
      this.data = sanitizeCompTimeData(raw);
    } catch {
      this.data = createEmptyCompTimeData();
    }
  }

  /** 将写操作排队执行，保证数据一致性 */
  private enqueue<T>(action: (data: CompTimeData) => Promise<T>): Promise<T> {
    /** 串行执行的承诺对象 */
    const result = this.pendingWrite.then(async () => {
      /** 当前排队操作的独立草稿，保存成功前不向读取方暴露 */
      const draft = this.getData();
      /** 操作结果仅在磁盘保存成功后返回 */
      const value = await action(draft);
      this.data = draft;
      return value;
    });
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  /** 持久化当前内存快照 */
  private async persist(data: CompTimeData): Promise<void> {
    await this.adapter.saveCompTimeData(data);
  }

  /** 读取当前调休数据的浅拷贝视图 */
  getData(): CompTimeData {
    return {
      schemaVersion: 1,
      specialDates: this.data.specialDates.map((item) => ({ ...item })),
      ignoredDates: [...this.data.ignoredDates],
      draftHourOverrides: { ...this.data.draftHourOverrides },
      overtimeNotes: { ...this.data.overtimeNotes },
      entries: Object.fromEntries(
        Object.entries(this.data.entries).map(([key, entry]) => [
          key,
          { ...entry, usages: entry.usages.map((usage) => ({ ...usage })) },
        ]),
      ),
    };
  }

  /** 等待此前已排队的保存完成，导出时读取最新事项 */
  flush(): Promise<void> {
    return this.pendingWrite;
  }

  /** 按日期自动保存加班事项，清空输入时删除对应文本 */
  setOvertimeNote(date: string, note: string): Promise<void> {
    if (!isValidIsoDate(date)) return Promise.reject(new Error("无效的加班日期"));
    return this.enqueue(async (data) => {
      if (note.trim()) data.overtimeNotes[date] = note;
      else delete data.overtimeNotes[date];
      await this.persist(data);
    });
  }

  /** 添加或更新公司公示的特殊加班日期 */
  addSpecialDate(date: string, note: string): Promise<void> {
    if (!isValidIsoDate(date)) return Promise.reject(new Error("请输入有效的特殊日期（YYYY-MM-DD）"));
    return this.enqueue(async (data) => {
      /** 过滤旧的同日记录，按日期排序存储 */
      const filtered = data.specialDates.filter((item) => item.date !== date);
      filtered.push({ date, note: note.trim() });
      filtered.sort((left, right) => right.date.localeCompare(left.date));
      data.specialDates = filtered;
      // 新增特殊日期时自动解除此前忽略状态
      data.ignoredDates = data.ignoredDates.filter((item) => item !== date);
      await this.persist(data);
    });
  }

  /** 移除公司公示的特殊加班日期 */
  removeSpecialDate(date: string): Promise<void> {
    return this.enqueue(async (data) => {
      data.specialDates = data.specialDates.filter((item) => item.date !== date);
      await this.persist(data);
    });
  }

  /** 保存当前周期自动带出项的人工微调时长 */
  setDraftHourOverride(date: string, hours: number): Promise<void> {
    if (!isValidIsoDate(date)) return Promise.reject(new Error("无效日期"));
    return this.enqueue(async (data) => {
      data.draftHourOverrides[date] = normalizeHalfHour(hours);
      await this.persist(data);
    });
  }

  /** 忽略某天自动带出的加班信息 */
  ignoreCandidateDate(date: string): Promise<void> {
    if (!isValidIsoDate(date)) return Promise.reject(new Error("无效日期"));
    return this.enqueue(async (data) => {
      if (!data.ignoredDates.includes(date)) {
        data.ignoredDates.push(date);
      }
      delete data.draftHourOverrides[date];
      await this.persist(data);
    });
  }

  /** 确认提报或手动新增一笔调休额度记录 */
  submitCompTime(input: {
    date: string;
    sourceType: CompTimeSourceType;
    hours: number;
    note: string;
  }): Promise<CompTimeLedgerEntry> {
    if (!isValidIsoDate(input.date)) return Promise.reject(new Error("请输入有效的加班日期"));
    /** 规范化后的调休小时数 */
    const hours = normalizeHalfHour(input.hours);
    if (hours <= 0) return Promise.reject(new Error("调休时长必须至少为 0.5 小时"));

    return this.enqueue(async (data) => {
      /** 初始到期日（加班当月起3个月内月底） */
      const initialExpiresAt = calculateInitialExpiryDate(input.date);
      /** 新建台账条目 */
      const entry: CompTimeLedgerEntry = {
        id: createUniqueId("comp"),
        date: input.date,
        sourceType: input.sourceType,
        hours,
        initialExpiresAt,
        expiresAt: initialExpiresAt,
        extended: false,
        usages: [],
        submittedAt: Date.now(),
        note: input.note.trim(),
      };
      data.entries[entry.id] = entry;
      delete data.draftHourOverrides[input.date];
      await this.persist(data);
      return { ...entry, usages: [] };
    });
  }

  /** 手动增减已提报台账的调休时长或备注 */
  updateEntry(id: string, hours: number, note: string): Promise<void> {
    /** 规范化后的小时数 */
    const normalizedHours = normalizeHalfHour(hours);
    if (normalizedHours <= 0) return Promise.reject(new Error("调休时长必须至少为 0.5 小时"));
    return this.enqueue(async (data) => {
      /** 待更新的台账记录 */
      const existing = data.entries[id];
      if (!existing) throw new Error("未找到对应的调休记录");
      /** 已使用总时长 */
      const usedHours = normalizeHalfHour(existing.usages.reduce((sum, item) => sum + item.usedHours, 0));
      if (normalizedHours < usedHours) {
        throw new Error(`调休时长不能小于已使用时长（${usedHours} 小时）`);
      }
      existing.hours = normalizedHours;
      existing.note = note.trim();
      await this.persist(data);
    });
  }

  /** 删除指定的已提报调休记录 */
  deleteEntry(id: string): Promise<void> {
    return this.enqueue(async (data) => {
      delete data.entries[id];
      await this.persist(data);
    });
  }

  /** 为指定调休记录执行一次延期（延长3个月至月底，限一次） */
  extendEntry(id: string): Promise<void> {
    return this.enqueue(async (data) => {
      /** 待延期的台账记录 */
      const existing = data.entries[id];
      if (!existing) throw new Error("未找到对应的调休记录");
      if (existing.extended) throw new Error("每笔调休仅支持延期一次");
      existing.expiresAt = calculateExtendedExpiryDate(existing.expiresAt);
      existing.extended = true;
      existing.extendedAt = Date.now();
      await this.persist(data);
    });
  }

  /** 登记使用调休时长，自动校验剩余可用额度 */
  addUsage(id: string, usedHours: number, usedDate: string, note: string): Promise<void> {
    if (!isValidIsoDate(usedDate)) return Promise.reject(new Error("请输入有效的使用日期"));
    /** 规范化后的本次使用小时数 */
    const hours = normalizeHalfHour(usedHours);
    if (hours <= 0) return Promise.reject(new Error("使用时长必须至少为 0.5 小时"));

    return this.enqueue(async (data) => {
      /** 目标台账记录 */
      const existing = data.entries[id];
      if (!existing) throw new Error("未找到对应的调休记录");
      /** 当前已使用小时数 */
      const currentUsed = normalizeHalfHour(existing.usages.reduce((sum, item) => sum + item.usedHours, 0));
      /** 剩余可用小时数 */
      const remaining = normalizeHalfHour(existing.hours - currentUsed);
      if (hours > remaining) {
        throw new Error(`本次使用 ${hours} 小时超出剩余可用额度（${remaining} 小时）`);
      }
      existing.usages.push({
        id: createUniqueId("use"),
        usedHours: hours,
        usedDate,
        note: note.trim(),
        createdAt: Date.now(),
      });
      await this.persist(data);
    });
  }

  /** 撤销单条使用记录 */
  removeUsage(entryId: string, usageId: string): Promise<void> {
    return this.enqueue(async (data) => {
      /** 目标台账记录 */
      const existing = data.entries[entryId];
      if (!existing) throw new Error("未找到对应的调休记录");
      existing.usages = existing.usages.filter((item) => item.id !== usageId);
      await this.persist(data);
    });
  }

  /** 解析并导入调休时长 JSON，按日期写入校准小时数 */
  importCompTimePayload(content: string): Promise<{ importedCount: number }> {
    /** 解析后的 JSON 对象 */
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      return Promise.reject(new Error("调休文件不是有效的 JSON 格式"));
    }

    /** 待导入的条目列表 */
    const rawItems = Array.isArray(parsed)
      ? parsed
      : isPlainObject(parsed) && Array.isArray(parsed.items)
        ? parsed.items
        : null;

    if (!rawItems) {
      return Promise.reject(new Error("调休 JSON 缺少 items 数组"));
    }

    /** 校验并收集有效日期与小时数 */
    const updates: { date: string; hours: number; overtimeNote?: string }[] = [];
    for (const item of rawItems) {
      if (!isPlainObject(item) || !isValidIsoDate(item.date)) {
        return Promise.reject(new Error("导入文件中包含无效日期（需为 YYYY-MM-DD）"));
      }
      if (typeof item.hours !== "number" || !Number.isFinite(item.hours) || item.hours < 0) {
        return Promise.reject(new Error(`${item.date} 的调休小时数无效`));
      }
      if (item.overtimeNote !== undefined && typeof item.overtimeNote !== "string") {
        return Promise.reject(new Error(`${item.date} 的加班事项必须为文本`));
      }
      updates.push({ date: item.date, hours: normalizeHalfHour(item.hours), overtimeNote: item.overtimeNote });
    }

    return this.enqueue(async (data) => {
      updates.forEach(({ date, hours, overtimeNote }) => {
        data.draftHourOverrides[date] = hours;
        // 旧文件没有事项字段时保留本地事项；明确传空文本才清空
        if (overtimeNote !== undefined) {
          if (overtimeNote.trim()) data.overtimeNotes[date] = overtimeNote;
          else delete data.overtimeNotes[date];
        }
      });
      await this.persist(data);
      return { importedCount: updates.length };
    });
  }
}

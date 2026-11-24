/** 公司公示的特殊加班日期配置 */
export interface CompTimeSpecialDate {
  /** 特殊日期，格式为 YYYY-MM-DD */
  date: string;
  /** 公司公示说明或备注 */
  note: string;
}

/** 调休加班记录的来源类型 */
export type CompTimeSourceType = "workday" | "rest-day" | "holiday" | "special-date" | "manual";

/** 单次使用调休的扣减明细 */
export interface CompTimeUsageEntry {
  /** 使用记录唯一标识 */
  id: string;
  /** 本次使用的调休小时数 */
  usedHours: number;
  /** 使用调休的日期，格式为 YYYY-MM-DD */
  usedDate: string;
  /** 使用说明或备注 */
  note: string;
  /** 创建时间戳 */
  createdAt: number;
}

/** 已确认提报并进入台账的调休记录 */
export interface CompTimeLedgerEntry {
  /** 调休台账条目唯一标识 */
  id: string;
  /** 产生加班的日期，格式为 YYYY-MM-DD */
  date: string;
  /** 加班来源类型 */
  sourceType: CompTimeSourceType;
  /** 已确认的调休总小时数 */
  hours: number;
  /** 初始有效期截止日（加班当月起第3个月月底） */
  initialExpiresAt: string;
  /** 当前有效截止日（未延期时等于初始截止日） */
  expiresAt: string;
  /** 是否已执行过一次延期 */
  extended: boolean;
  /** 延期操作时间戳 */
  extendedAt?: number;
  /** 该笔调休的使用扣减记录 */
  usages: CompTimeUsageEntry[];
  /** 提报时间戳 */
  submittedAt: number;
  /** 备注说明 */
  note: string;
}

/** 独立保存在本地的调休统计持久化数据 */
export interface CompTimeData {
  /** 数据结构版本号 */
  schemaVersion: 1;
  /** 公司公示的特殊加班日期列表 */
  specialDates: CompTimeSpecialDate[];
  /** 用户手动忽略不提报的加班日期 */
  ignoredDates: string[];
  /** 当前周期自动带出记录的人工调整小时数映射 */
  draftHourOverrides: Record<string, number>;
  /** 按加班日期保存的加班事项 */
  overtimeNotes: Record<string, string>;
  /** 已提报的调休台账索引 */
  entries: Record<string, CompTimeLedgerEntry>;
}

/** 调休数据本地文件读写适配器 */
export interface CompTimeDataAdapter {
  /** 读取本地保存的调休数据 */
  loadCompTimeData: () => Promise<unknown>;
  /** 写入最新的调休数据 */
  saveCompTimeData: (data: CompTimeData) => Promise<void>;
}

/** 以每月21日为关账日的考勤周期信息 */
export interface CompTimePeriod {
  /** 周期标识，格式为 YYYY-MM */
  key: string;
  /** 周期起始日期（上月22日） */
  startDate: string;
  /** 周期结束日期（本月21日） */
  endDate: string;
  /** 周期关账截止日（本月21日） */
  closeDate: string;
}

/** 单日加班时长计算明细 */
export interface CompTimeCalculationResult {
  /** 扣除吃饭时间及工作日8小时正常工时后的净加班分钟数 */
  rawNetMinutes: number;
  /** 按0.5小时向下取整且未封顶的加班小时数 */
  uncappedHours: number;
  /** 最终计入的加班小时数（含跨夜最多4小时封顶） */
  calculatedHours: number;
  /** 是否触发了跨夜最多4小时封顶 */
  cappedByOvernight: boolean;
}

/** 当前考勤周期内自动带出的待核实加班候选项 */
export interface CompTimeCandidate {
  /** 加班日期 */
  date: string;
  /** 自动带出原因（工作日、休息日、法定节假日或特殊日期） */
  sourceType: Exclude<CompTimeSourceType, "manual">;
  /** 特殊日期备注说明 */
  specialNote: string;
  /** 上班打卡分钟数 */
  startMinute: number | null;
  /** 下班打卡分钟数 */
  endMinute: number | null;
  /** 是否为跨夜加班 */
  isOvernight: boolean;
  /** 时长计算明细 */
  calculation: CompTimeCalculationResult;
  /** 经人工微调或默认计算后的拟提报小时数 */
  adjustedHours: number;
  /** 是否已过加班当日（满足自加班第二日起可提交） */
  canSubmit: boolean;
  /** 该日期是否已提报进入台账 */
  submitted: boolean;
}

/** 调休台账条目的当前生命周期状态 */
export type CompTimeLedgerStatus = "available" | "expiring-soon" | "used-up" | "expired";

/** 供页面展示的调休台账视图模型 */
export interface CompTimeLedgerViewItem {
  /** 原始台账数据 */
  entry: CompTimeLedgerEntry;
  /** 累计已使用小时数 */
  usedHours: number;
  /** 剩余可用小时数 */
  remainingHours: number;
  /** 当前状态 */
  status: CompTimeLedgerStatus;
  /** 距离截止日期的剩余天数（负数表示已过期） */
  daysUntilExpiry: number;
  /** 是否允许执行一次延期3个月 */
  canExtend: boolean;
}

/** 调休统计顶部指标卡汇总 */
export interface CompTimeSummary {
  /** 当前可用调休总小时数 */
  availableHours: number;
  /** 当前周期内尚未提报的待确认小时数 */
  pendingHours: number;
  /** 当前周期内尚未提报的待确认天数 */
  pendingCount: number;
  /** 30天内即将到期的可用调休小时数 */
  expiringSoonHours: number;
  /** 累计已使用调休小时数 */
  usedHours: number;
  /** 累计已过期失效的调休小时数 */
  expiredHours: number;
}

/** 调休统计区间内的单日可提报明细行 */
export interface CompTimeReportRow {
  /** 加班日期，格式为 YYYY-MM-DD */
  date: string;
  /** 加班来源类型 */
  sourceType: Exclude<CompTimeSourceType, "manual">;
  /** 上班打卡分钟数 */
  startMinute: number | null;
  /** 下班打卡分钟数 */
  endMinute: number | null;
  /** 是否因跨夜占用最早打卡而默认09:00起算 */
  assumedStart: boolean;
  /** 是否为跨夜加班 */
  isOvernight: boolean;
  /** 规则计算得到的时长（小时） */
  calculatedHours: number;
  /** 最终可提报时长（小时，含导入覆盖值） */
  reportableHours: number;
  /** 是否使用了导入校准时长 */
  fromImport: boolean;
  /** 当日加班事项 */
  overtimeNote: string;
  /** 按3个月月底规则计算的参考有效期截止日 */
  referenceExpiresAt: string;
}

/** 调休时长导入导出的标准 JSON 结构 */
export interface CompTimeExportPayload {
  /** 固定格式标识 */
  format: "overtime-visualizer-comp-time";
  /** 数据格式版本号 */
  version: 1;
  /** 导出时间戳 */
  exportedAt: string;
  /** 统计起始日期 */
  startDate: string;
  /** 统计结束日期 */
  endDate: string;
  /** 区间可提报总时长（小时） */
  totalHours: number;
  /** 每日可调休明细列表 */
  items: {
    date: string;
    hours: number;
    sourceType?: CompTimeSourceType;
    referenceExpiresAt?: string;
    /** 可选加班事项，兼容未提供该字段的旧文件 */
    overtimeNote?: string;
  }[];
}

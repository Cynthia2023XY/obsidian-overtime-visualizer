import type { AttendanceRecord } from "../types/attendance";
import type {
  CompTimeCalculationResult,
  CompTimeCandidate,
  CompTimeData,
  CompTimeLedgerStatus,
  CompTimeLedgerViewItem,
  CompTimePeriod,
  CompTimeReportRow,
  CompTimeSummary,
} from "../types/comp-time";

/** 每月考勤周期关账日（含当日为本周期最后一天） */
export const COMP_TIME_CLOSE_DAY = 21;

/** 跨夜加班当天最多计入的调休小时数 */
export const COMP_TIME_OVERNIGHT_CAP_HOURS = 4;

/** 调休即将到期提醒的提前天数阈值 */
export const COMP_TIME_EXPIRING_SOON_DAYS = 30;

/** 午休吃饭不计入加班的时段（12:00-13:00） */
export const COMP_TIME_LUNCH_BREAK: readonly [number, number] = [12 * 60, 13 * 60];

/** 晚饭休息不计入加班的时段（18:00-19:00） */
export const COMP_TIME_DINNER_BREAK: readonly [number, number] = [18 * 60, 19 * 60];

/** 工作日进入加班统计的起始基准分钟数（18:00，配合18:00-19:00晚饭扣除后等价于19:00起算） */
export const COMP_TIME_WORKDAY_OVERTIME_START_MINUTE = 18 * 60;

/** 默认的调休统计持久化数据结构 */
export function createEmptyCompTimeData(): CompTimeData {
  return {
    schemaVersion: 1,
    specialDates: [],
    ignoredDates: [],
    draftHourOverrides: {},
    entries: {},
  };
}

/** 将小时数规范为保留一位小数的0.5步长精度 */
export function normalizeHalfHour(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 2) / 2;
}

/** 计算指定公历年月的最后一天，格式为 YYYY-MM-DD */
export function getLastDayOfMonth(year: number, month: number): string {
  /** 零日技巧自动定位当月最后一天 */
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

/** 根据给定基准日期（YYYY-MM-DD）与偏移月数计算目标年月月底 */
function addMonthsToEndOfMonth(baseDate: string, monthsToAdd: number): string {
  /** 基准年份 */
  const baseYear = Number(baseDate.slice(0, 4));
  /** 基准月份（1-12） */
  const baseMonth = Number(baseDate.slice(5, 7));
  /** 换算为零基总月数 */
  const totalZeroBasedMonths = baseYear * 12 + (baseMonth - 1) + monthsToAdd;
  /** 目标年份 */
  const targetYear = Math.floor(totalZeroBasedMonths / 12);
  /** 目标月份（1-12） */
  const targetMonth = (totalZeroBasedMonths % 12) + 1;
  return getLastDayOfMonth(targetYear, targetMonth);
}

/** 计算加班调休的初始到期日：加班所在月起3个月内使用完（如7月13日 -> 9月30日） */
export function calculateInitialExpiryDate(overtimeDate: string): string {
  return addMonthsToEndOfMonth(overtimeDate, 2);
}

/** 计算延期一次后的到期日：在当前截止月份基础上延长3个月（如9月30日 -> 12月31日） */
export function calculateExtendedExpiryDate(currentExpiryDate: string): string {
  return addMonthsToEndOfMonth(currentExpiryDate, 3);
}

/** 计算两个时间区间 [aStart, aEnd] 与 [bStart, bEnd] 的重叠分钟数 */
function getOverlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** 按规则计算单日加班净时长：工作日自18:00后起算，扣除12:00-13:00及18:00-19:00，0.5h向下取整，跨夜最多4h */
export function calculateCompTimeOvertime(
  startMinute: number | null,
  endMinute: number | null,
  isOvernight: boolean,
  isWorkday = false,
): CompTimeCalculationResult {
  if (startMinute === null || endMinute === null || endMinute <= startMinute) {
    return {
      rawNetMinutes: 0,
      uncappedHours: 0,
      calculatedHours: 0,
      cappedByOvernight: false,
    };
  }

  /** 工作日仅统计正常下班基准（18:00）之后的部分，非工作日从上班打卡起算 */
  const effectiveStart = isWorkday ? Math.max(startMinute, COMP_TIME_WORKDAY_OVERTIME_START_MINUTE) : startMinute;
  if (endMinute <= effectiveStart) {
    return {
      rawNetMinutes: 0,
      uncappedHours: 0,
      calculatedHours: 0,
      cappedByOvernight: false,
    };
  }

  /** 当日午休和晚饭扣除的总分钟数 */
  const breakMinutes = getOverlapMinutes(effectiveStart, endMinute, COMP_TIME_LUNCH_BREAK[0], COMP_TIME_LUNCH_BREAK[1])
    + getOverlapMinutes(effectiveStart, endMinute, COMP_TIME_DINNER_BREAK[0], COMP_TIME_DINNER_BREAK[1]);

  /** 扣除休息时间后的净加班分钟数 */
  const rawNetMinutes = Math.max(0, endMinute - effectiveStart - breakMinutes);
  /** 不足0.5小时不计，满0.5小时按0.5小时向下取整 */
  const uncappedHours = Math.floor(rawNetMinutes / 30) * 0.5;
  /** 跨夜当天最多计算4小时 */
  const overnight = isOvernight || endMinute >= 24 * 60;
  /** 应用跨夜封顶后的最终加班小时数 */
  const calculatedHours = overnight ? Math.min(uncappedHours, COMP_TIME_OVERNIGHT_CAP_HOURS) : uncappedHours;

  return {
    rawNetMinutes,
    uncappedHours,
    calculatedHours,
    cappedByOvernight: overnight && uncappedHours > COMP_TIME_OVERNIGHT_CAP_HOURS,
  };
}

/** 根据参考日期获取当前考勤周期（上月22日至本月21日；过21日则进入下周期） */
export function getAttendanceCycle(referenceDate: string): CompTimePeriod {
  /** 参考日期年份 */
  const year = Number(referenceDate.slice(0, 4));
  /** 参考日期月份（1-12） */
  const month = Number(referenceDate.slice(5, 7));
  /** 参考日期日号 */
  const day = Number(referenceDate.slice(8, 10));

  /** 关账日所在年月 */
  const closeTotalMonths = year * 12 + (month - 1) + (day > COMP_TIME_CLOSE_DAY ? 1 : 0);
  /** 关账年份 */
  const closeYear = Math.floor(closeTotalMonths / 12);
  /** 关账月份（1-12） */
  const closeMonth = (closeTotalMonths % 12) + 1;

  /** 起始月为关账月的前一个月 */
  const startTotalMonths = closeTotalMonths - 1;
  /** 起始年份 */
  const startYear = Math.floor(startTotalMonths / 12);
  /** 起始月份（1-12） */
  const startMonth = (startTotalMonths % 12) + 1;

  /** 周期键 YYYY-MM */
  const key = `${closeYear}-${String(closeMonth).padStart(2, "0")}`;
  /** 周期起始日（上月22日） */
  const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-22`;
  /** 周期关账日（本月21日） */
  const closeDate = `${key}-${String(COMP_TIME_CLOSE_DAY).padStart(2, "0")}`;

  return {
    key,
    startDate,
    endDate: closeDate,
    closeDate,
  };
}

/** 计算两个 ISO 日期之间的相差天数（target - base） */
export function diffIsoDays(baseDate: string, targetDate: string): number {
  /** 基准日期 UTC 毫秒 */
  const baseMs = Date.parse(`${baseDate}T00:00:00Z`);
  /** 目标日期 UTC 毫秒 */
  const targetMs = Date.parse(`${targetDate}T00:00:00Z`);
  return Math.round((targetMs - baseMs) / 86_400_000);
}

/** 判断一条考勤记录是否为已确认跨夜 */
export function isOvernightAttendance(record: AttendanceRecord): boolean {
  return record.overnightState === "linked"
    || record.overnightState === "confirmed"
    || (record.endMinute !== null && record.endMinute >= 24 * 60);
}

/** 自动带出当前考勤周期内有加班时长的记录（含日常工作日加班、休息日、法定节假日及特殊日期），过往周期未提报自动清空 */
export function getCurrentCycleCandidates(
  records: AttendanceRecord[],
  data: CompTimeData,
  today: string,
): CompTimeCandidate[] {
  /** 当前所处考勤周期 */
  const period = getAttendanceCycle(today);
  /** 公司公示特殊日期索引 */
  const specialMap = new Map(data.specialDates.map((item) => [item.date, item.note]));
  /** 用户主动忽略的日期集合 */
  const ignoredSet = new Set(data.ignoredDates);
  /** 台账中已提报的日期集合 */
  const submittedDates = new Set(Object.values(data.entries).map((entry) => entry.date));

  return records
    .filter((record) => record.date >= period.startDate && record.date <= period.endDate)
    .filter((record) => record.startMinute !== null && record.endMinute !== null)
    .filter((record) => !ignoredSet.has(record.date))
    .map((record): CompTimeCandidate => {
      /** 优先识别法定节假日，其次为公司公示特殊日期，其余按休息日或工作日加班处理 */
      const sourceType: CompTimeCandidate["sourceType"] = record.dayType === "holiday"
        ? "holiday"
        : specialMap.has(record.date)
          ? "special-date"
          : record.dayType === "rest-day"
            ? "rest-day"
            : "workday";
      /** 特殊日期备注 */
      const specialNote = specialMap.get(record.date) ?? "";
      /** 是否跨夜 */
      const isOvernight = isOvernightAttendance(record);
      /** 日常工作日仅从18:00后计算加班，节假日、休息日与特殊日期全天计入 */
      const isWorkdayOnly = sourceType === "workday";
      /** 规则计算结果 */
      const calculation = calculateCompTimeOvertime(record.startMinute, record.endMinute, isOvernight, isWorkdayOnly);
      /** 若存在人工微调则采用微调值 */
      const override = data.draftHourOverrides[record.date];
      /** 最终拟提报时长 */
      const adjustedHours = override !== undefined ? normalizeHalfHour(override) : calculation.calculatedHours;
      /** 自加班第二日起才允许提报，且时长需大于0 */
      const canSubmit = today > record.date && adjustedHours > 0;
      /** 该日期是否已提报 */
      const submitted = submittedDates.has(record.date);

      return {
        date: record.date,
        sourceType,
        specialNote,
        startMinute: record.startMinute,
        endMinute: record.endMinute,
        isOvernight,
        calculation,
        adjustedHours,
        canSubmit,
        submitted,
      };
    })
    .filter((candidate) => candidate.adjustedHours > 0 || candidate.submitted || data.draftHourOverrides[candidate.date] !== undefined)
    .sort((left, right) => right.date.localeCompare(left.date));
}

/** 将已提报台账计算为带可用余额、过期状态与延期权限的视图列表 */
export function buildCompTimeLedgerViews(data: CompTimeData, today: string): CompTimeLedgerViewItem[] {
  return Object.values(data.entries)
    .map((entry): CompTimeLedgerViewItem => {
      /** 累计已使用小时数 */
      const usedHours = normalizeHalfHour(entry.usages.reduce((sum, usage) => sum + usage.usedHours, 0));
      /** 剩余可用小时数 */
      const remainingHours = Math.max(0, normalizeHalfHour(entry.hours - usedHours));
      /** 距离有效期截止日的剩余天数 */
      const daysUntilExpiry = diffIsoDays(today, entry.expiresAt);
      /** 根据余额和到期日期确定当前状态 */
      let status: CompTimeLedgerStatus = "available";
      if (remainingHours <= 0) {
        status = "used-up";
      } else if (daysUntilExpiry < 0) {
        status = "expired";
      } else if (daysUntilExpiry <= COMP_TIME_EXPIRING_SOON_DAYS) {
        status = "expiring-soon";
      }
      /** 仅在未用完、未过期且未延期过时允许延期一次 */
      const canExtend = !entry.extended && remainingHours > 0 && daysUntilExpiry >= 0;

      return {
        entry,
        usedHours,
        remainingHours,
        status,
        daysUntilExpiry,
        canExtend,
      };
    })
    .sort((left, right) => {
      // 优先展示即将到期与可用记录，其次按加班日期倒序
      if (left.entry.date !== right.entry.date) return right.entry.date.localeCompare(left.entry.date);
      return right.entry.submittedAt - left.entry.submittedAt;
    });
}

/** 汇总调休统计顶部指标卡所需的核心数字 */
export function summarizeCompTime(
  candidates: CompTimeCandidate[],
  ledgerViews: CompTimeLedgerViewItem[],
): CompTimeSummary {
  /** 当前可用调休总小时数（含即将到期但尚未过期） */
  let availableHours = 0;
  /** 30天内即将到期小时数 */
  let expiringSoonHours = 0;
  /** 累计已使用小时数 */
  let usedHours = 0;
  /** 累计已过期失效小时数 */
  let expiredHours = 0;

  ledgerViews.forEach((item) => {
    usedHours += item.usedHours;
    if (item.status === "available" || item.status === "expiring-soon") {
      availableHours += item.remainingHours;
    }
    if (item.status === "expiring-soon") {
      expiringSoonHours += item.remainingHours;
    }
    if (item.status === "expired") {
      expiredHours += item.remainingHours;
    }
  });

  /** 当前周期内尚未提报且时长大于0的候选项 */
  const pendingCandidates = candidates.filter((candidate) => !candidate.submitted && candidate.adjustedHours > 0);
  /** 当前周期内尚未提报的待确认总小时数 */
  const pendingHours = pendingCandidates.reduce((sum, item) => sum + item.adjustedHours, 0);

  return {
    availableHours: normalizeHalfHour(availableHours),
    pendingHours: normalizeHalfHour(pendingHours),
    pendingCount: pendingCandidates.length,
    expiringSoonHours: normalizeHalfHour(expiringSoonHours),
    usedHours: normalizeHalfHour(usedHours),
    expiredHours: normalizeHalfHour(expiredHours),
  };
}

/** 按指定日期区间统计每日可提报调休明细与总时长 */
export function calculateCompTimeReport(
  records: AttendanceRecord[],
  data: CompTimeData,
  startDate: string,
  endDate: string,
): { rows: CompTimeReportRow[]; totalHours: number } {
  /** 特殊日期索引 */
  const specialMap = new Map(data.specialDates.map((item) => [item.date, item.note]));
  /** 考勤记录按日期索引 */
  const recordMap = new Map(records.map((record) => [record.date, record]));
  /** 覆盖区间内的全部候选日期（考勤记录 + 导入覆盖日期） */
  const allDates = new Set<string>();
  records.forEach((record) => {
    if (record.date >= startDate && record.date <= endDate) allDates.add(record.date);
  });
  Object.keys(data.draftHourOverrides).forEach((date) => {
    if (date >= startDate && date <= endDate) allDates.add(date);
  });

  /** 区间内有效可调休明细行 */
  const rows: CompTimeReportRow[] = [];

  allDates.forEach((date) => {
    /** 当日考勤记录 */
    const record = recordMap.get(date);
    /** 来源类型 */
    const sourceType: CompTimeReportRow["sourceType"] = record?.dayType === "holiday"
      ? "holiday"
      : specialMap.has(date)
        ? "special-date"
        : record?.dayType === "rest-day"
          ? "rest-day"
          : "workday";
    /** 是否跨夜 */
    const isOvernight = record ? isOvernightAttendance(record) : false;
    /** 按规则计算得到的时长 */
    const calculation = record
      ? calculateCompTimeOvertime(record.startMinute, record.endMinute, isOvernight, sourceType === "workday")
      : { rawNetMinutes: 0, uncappedHours: 0, calculatedHours: 0, cappedByOvernight: false };
    /** 是否存在导入校准值 */
    const override = data.draftHourOverrides[date];
    /** 最终可提报时长 */
    const reportableHours = override !== undefined ? normalizeHalfHour(override) : calculation.calculatedHours;

    if (reportableHours <= 0) return;

    rows.push({
      date,
      sourceType,
      startMinute: record?.startMinute ?? null,
      endMinute: record?.endMinute ?? null,
      isOvernight,
      calculatedHours: calculation.calculatedHours,
      reportableHours,
      fromImport: override !== undefined,
      referenceExpiresAt: calculateInitialExpiryDate(date),
    });
  });

  rows.sort((left, right) => right.date.localeCompare(left.date));
  /** 区间可提报总小时数 */
  const totalHours = normalizeHalfHour(rows.reduce((sum, item) => sum + item.reportableHours, 0));

  return { rows, totalHours };
}

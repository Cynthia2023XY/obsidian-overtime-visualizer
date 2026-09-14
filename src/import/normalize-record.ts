import type { OvertimeVisualizerSettings } from "../settings";
import type { AttendanceDayType, AttendanceState } from "../types/attendance";
import type { NormalizeResult, SourceAttendanceDto } from "../types/import";

/** HR 星期文案到 ISO 星期数字的映射 */
const WEEKDAY_TEXT_MAP: Record<string, number> = { "星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4, "星期五": 5, "星期六": 6, "星期日": 7, "星期天": 7 };

/** 判断未知值是否为可清洗的原始对象 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 将未知原始字段收窄为可选字符串 */
function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 解析并严格校验 HR 日期，返回 ISO 日期和星期 */
function parseAttendanceDate(value: unknown): { date: string; weekday: number } | null {
  if (typeof value !== "string") return null;
  /** HR 日期中的年、月、日匹配结果 */
  const match = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(value.trim());
  if (!match) return null;
  /** 日期中的年份 */
  const year = Number(match[1]);
  /** 日期中的月份 */
  const month = Number(match[2]);
  /** 日期中的日数 */
  const day = Number(match[3]);
  /** 使用 UTC 构建以避免时区导致日期偏移的日期对象 */
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) return null;
  /** JavaScript 星期转换得到的 ISO 星期 */
  const weekday = parsedDate.getUTCDay() === 0 ? 7 : parsedDate.getUTCDay();
  return { date: `${match[1]}-${match[2]}-${match[3]}`, weekday };
}

/** 将 HH:mm:ss 或 HH:mm 时间按秒四舍五入到分钟 */
function parseClockMinute(value: unknown): number | null {
  if (typeof value !== "string") return null;
  /** 时间字符串中的时、分、秒匹配结果 */
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  /** 时间中的小时数 */
  const hours = Number(match[1]);
  /** 时间中的分钟数 */
  const minutes = Number(match[2]);
  /** 时间中的秒数 */
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + Math.round(seconds / 60);
}

/** 将 HR 工作日类型映射为稳定内部枚举 */
function mapDayType(value: string | null): AttendanceDayType {
  if (value === "工作日") return "workday";
  if (value === "休息日") return "rest-day";
  if (value === "假日") return "holiday";
  return "unknown";
}

/** 从申请原因中提取真实假别，排除正常、休息、节假日和跨夜加班 */
function extractLeaveReasons(value: string | null): string[] {
  if (!value) return [];
  /** 不代表员工请假的考勤原因 */
  const excludedReasons = new Set(["正常", "休息日", "节假日", "跨夜加班"]);
  return value.split(/[,，]/).map((reason) => reason.trim()).filter((reason) => reason.includes("假") && !excludedReasons.has(reason));
}

/** 根据日类型、打卡完整性和假别判定考勤状态 */
function classifyAttendanceState(dayType: AttendanceDayType, startMinute: number | null, endMinute: number | null, leaveReasons: string[]): AttendanceState {
  if (startMinute !== null && endMinute !== null) return leaveReasons.length > 0 ? "partial-leave" : "complete";
  if ((startMinute === null) !== (endMinute === null)) return "incomplete";
  if (dayType !== "workday") return "non-working-day";
  return leaveReasons.length > 0 ? "full-leave" : "missing-punch";
}

/** 将单个 HR 考勤对象脱敏并规范化为内部日记录 */
export function normalizeAttendanceRecord(raw: unknown, settings: OvertimeVisualizerSettings): NormalizeResult {
  if (!isObject(raw)) return { success: false, message: "考勤项必须是 JSON 对象" };
  /** 经过白名单读取的 HR 原始对象 */
  const dto = raw as SourceAttendanceDto;
  /** 解析并校验后的考勤日期 */
  const parsedDate = parseAttendanceDate(dto.attendanceDay);
  if (!parsedDate) return { success: false, message: "attendanceDay 缺失或不是有效日期" };

  /** 原始上班时间文本 */
  const startText = readOptionalString(dto.attendanceStartTime);
  /** 原始下班时间文本 */
  const endText = readOptionalString(dto.attendanceEndTime);
  /** 上班时间对应的分钟数 */
  const startMinute = startText ? parseClockMinute(startText) : null;
  /** 下班时间对应的分钟数 */
  const endMinute = endText ? parseClockMinute(endText) : null;
  if (startText && startMinute === null) return { success: false, message: `${parsedDate.date} 的 attendanceStartTime 无效` };
  if (endText && endMinute === null) return { success: false, message: `${parsedDate.date} 的 attendanceEndTime 无效` };

  /** HR 原始工作日类型 */
  const workDayType = readOptionalString(dto.workDayType);
  /** 映射后的内部日类型 */
  const dayType = mapDayType(workDayType);
  /** HR 原始申请原因 */
  const applyReason = readOptionalString(dto.applyReason);
  /** 申请原因中提取的真实假别 */
  const leaveReasons = extractLeaveReasons(applyReason);
  /** 记录导入时发现的非阻断警告 */
  const warnings: string[] = [];
  /** HR 原始星期文本 */
  const weekDayText = readOptionalString(dto.weekDay);
  if (dayType === "unknown") warnings.push(`未知工作日类型：${workDayType ?? "空"}`);
  if (weekDayText && WEEKDAY_TEXT_MAP[weekDayText] !== parsedDate.weekday) warnings.push(`星期与日期不一致：${weekDayText}`);

  return {
    success: true,
    record: {
      date: parsedDate.date,
      weekday: parsedDate.weekday,
      dayType,
      startMinute,
      endMinute,
      attendanceState: classifyAttendanceState(dayType, startMinute, endMinute, leaveReasons),
      overnightState: applyReason?.includes("跨夜加班") ? "confirmed" : "none",
      isReleaseDay: settings.releaseWeekdays.includes(parsedDate.weekday),
      leaveReasons,
      warnings,
      source: {
        attendanceDay: String(dto.attendanceDay),
        attendanceStartTime: startText,
        attendanceEndTime: endText,
        weekDay: weekDayText,
        workDayType,
        applyReason,
        attendanceStatus: readOptionalString(dto.attendanceStatus),
      },
      manuallyEdited: false,
    },
  };
}

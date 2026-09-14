import type { AttendanceRecord } from "./attendance";

/** HR 接口中导入器允许读取的原始字段 */
export interface SourceAttendanceDto {
  attendanceDay?: unknown;
  attendanceStartTime?: unknown;
  attendanceEndTime?: unknown;
  weekDay?: unknown;
  workDayType?: unknown;
  applyReason?: unknown;
  attendanceStatus?: unknown;
}

/** 单条考勤记录的规范化结果 */
export type NormalizeResult =
  | { success: true; record: AttendanceRecord }
  | { success: false; message: string };

/** 单条导入预览的处理类型 */
export type ImportItemAction = "create" | "update" | "skip" | "error";

/** 单条导入数据在落库前的预览结果 */
export interface ImportPreviewItem {
  index: number;
  date: string | null;
  action: ImportItemAction;
  message: string;
  record: AttendanceRecord | null;
}

/** 整批 JSON 导入的可审核预览 */
export interface ImportPreview {
  items: ImportPreviewItem[];
  recordsToWrite: AttendanceRecord[];
  createCount: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
}

/** 跨夜关联阶段输出的数据与警告 */
export interface OvernightLinkResult {
  records: AttendanceRecord[];
  warnings: string[];
}

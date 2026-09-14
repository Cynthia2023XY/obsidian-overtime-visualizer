import type { OvertimeVisualizerSettings } from "../settings";
import type { AttendanceRecord } from "../types/attendance";
import type { ImportPreview, ImportPreviewItem } from "../types/import";
import { linkOvernightRecords } from "./link-overnight";
import { normalizeAttendanceRecord } from "./normalize-record";

/** 判断新旧记录是否在可持久化字段上完全一致 */
function areRecordsEqual(left: AttendanceRecord, right: AttendanceRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 根据原始列表、已有数据和统计设置生成不落库的导入预览 */
export function prepareAttendanceImport(
  rawItems: unknown[],
  existingRecords: AttendanceRecord[],
  settings: OvertimeVisualizerSettings,
): ImportPreview {
  /** 按日期查找已有数据的索引 */
  const existingByDate = new Map(existingRecords.map((record) => [record.date, record]));
  /** 已在本批数据中出现的日期 */
  const incomingDates = new Set<string>();
  /** 经过规范化且本批无重复的候选记录 */
  const normalizedRecords: AttendanceRecord[] = [];
  /** 原始列表中每个候选记录的行号 */
  const sourceIndexes = new Map<string, number>();
  /** 无法进入关联阶段的预览错误 */
  const errorItems: ImportPreviewItem[] = [];

  rawItems.forEach((rawItem, index) => {
    /** 单条原始考勤的规范化结果 */
    const result = normalizeAttendanceRecord(rawItem, settings);
    if (!result.success) {
      errorItems.push({ index, date: null, action: "error", message: result.message, record: null });
      return;
    }
    if (incomingDates.has(result.record.date)) {
      errorItems.push({ index, date: result.record.date, action: "error", message: "本批数据中存在重复日期", record: null });
      return;
    }
    incomingDates.add(result.record.date);
    sourceIndexes.set(result.record.date, index);
    normalizedRecords.push(result.record);
  });

  /** 用于跨月和分批关联的新旧合并记录 */
  const recordsForLinking = [
    ...existingRecords.filter((record) => !incomingDates.has(record.date)),
    ...normalizedRecords,
  ];
  /** 完成跨夜关联后的新旧记录结果 */
  const linkedResult = linkOvernightRecords(recordsForLinking, settings.overnightCutoffMinute);
  /** 跨夜关联后按日期查找记录的索引 */
  const linkedByDate = new Map(linkedResult.records.map((record) => [record.date, record]));
  /** 每条有效候选数据的写入决策 */
  const resolvedItems: ImportPreviewItem[] = normalizedRecords.map((record) => {
    /** 关联跨夜后的最终候选记录 */
    const linkedRecord = linkedByDate.get(record.date) ?? record;
    /** 相同日期的已有记录 */
    const existingRecord = existingByDate.get(record.date);
    /** 当前候选记录在原始列表中的行号 */
    const index = sourceIndexes.get(record.date) ?? -1;
    if (!existingRecord) return { index, date: record.date, action: "create", message: "新增记录", record: linkedRecord };
    if (existingRecord.manuallyEdited) return { index, date: record.date, action: "skip", message: "已有记录包含人工修改，默认保留", record: linkedRecord };
    if (areRecordsEqual(existingRecord, linkedRecord)) return { index, date: record.date, action: "skip", message: "与已有记录相同", record: linkedRecord };
    return { index, date: record.date, action: "update", message: "覆盖未手工修改的已有记录", record: linkedRecord };
  });

  /** 跨夜关联导致派生字段发生变化的相邻已有记录 */
  const relatedItems: ImportPreviewItem[] = linkedResult.records.filter((record) => {
    /** 当前相邻日期的已有记录 */
    const existingRecord = existingByDate.get(record.date);
    return !incomingDates.has(record.date) && existingRecord !== undefined && !areRecordsEqual(existingRecord, record);
  }).map((record, offset) => {
    /** 当前受跨夜关联影响的已有记录 */
    const existingRecord = existingByDate.get(record.date)!;
    if (existingRecord.manuallyEdited) {
      return { index: rawItems.length + offset, date: record.date, action: "skip", message: "相邻记录包含人工修改，未自动更新跨夜状态", record };
    }
    return { index: rawItems.length + offset, date: record.date, action: "update", message: "跨夜关联需同步更新相邻已有记录", record };
  });

  /** 与原始输入顺序一致的完整预览列表 */
  const items = [...resolvedItems, ...relatedItems, ...errorItems].sort((left, right) => left.index - right.index);
  /** 本批确认后应写入的新增与更新记录 */
  const recordsToWrite = items.filter((item) => (item.action === "create" || item.action === "update") && item.record !== null).map((item) => item.record as AttendanceRecord);
  return {
    items,
    recordsToWrite,
    createCount: items.filter((item) => item.action === "create").length,
    updateCount: items.filter((item) => item.action === "update").length,
    skipCount: items.filter((item) => item.action === "skip").length,
    errorCount: items.filter((item) => item.action === "error").length,
  };
}

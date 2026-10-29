import { prepareAttendanceImport } from "../import/import-service";
import type { PluginDataRepository } from "../repository/plugin-data-repository";

/** 同步导入所需的仓储读取和批量写入能力 */
export type AttendanceSyncRepository = Pick<PluginDataRepository, "list" | "getSettings" | "importBatch">;

/** 自动抓取文件中可安全导入的考勤与采集信息 */
export interface AttendanceSyncPayload {
  capturedAt: string;
  startDate: string;
  endDate: string;
  total: number;
  list: unknown[];
}

/** 校验自动抓取文件的结构与完整性，避免将部分响应写入看板 */
export function parseSyncPayload(content: string): AttendanceSyncPayload {
  // 文件必须由抓取任务明确标记为完整快照
  let payload: unknown;
  try { payload = JSON.parse(content) as unknown; } catch { throw new Error("自动同步文件不是有效 JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("自动同步文件格式无效");
  // 收窄未知 JSON 后逐项校验采集结果
  const data = payload as Record<string, unknown>;
  if (data.schemaVersion !== 1 || data.complete !== true || typeof data.capturedAt !== "string" || !Number.isFinite(Date.parse(data.capturedAt)) || typeof data.startDate !== "string" || typeof data.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(data.endDate) || data.startDate > data.endDate || !Number.isSafeInteger(data.total) || (data.total as number) < 0 || !Array.isArray(data.list) || data.list.length !== data.total) throw new Error("自动同步文件不完整或采集信息无效");
  return { capturedAt: data.capturedAt, startDate: data.startDate, endDate: data.endDate, total: data.total, list: data.list };
}

/** 校验并合并自动抓取结果，沿用手工修改保护与跨夜关联规则 */
export async function importSyncPayload(content: string, repository: AttendanceSyncRepository): Promise<{ create: number; update: number; skip: number }> {
  // 自动抓取结果只有完整快照才能进入导入预览
  const payload = parseSyncPayload(content);
  // 已有导入服务负责去重、冲突识别和跨夜关联
  const preview = prepareAttendanceImport(payload.list, repository.list(), repository.getSettings());
  if (preview.errorCount) throw new Error(`自动同步数据存在 ${preview.errorCount} 条错误，未写入`);
  if (preview.items.some((item) => item.index < payload.list.length && item.date && (item.date < payload.startDate || item.date > payload.endDate))) throw new Error("自动同步数据超出采集日期范围，未写入");
  if (preview.recordsToWrite.length) await repository.importBatch(preview.recordsToWrite);
  return { create: preview.createCount, update: preview.updateCount, skip: preview.skipCount };
}

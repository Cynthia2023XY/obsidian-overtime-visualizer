import { DEFAULT_SETTINGS } from "../settings";
import type { AttendanceRecord } from "../types/attendance";
import type { OvertimeVisualizerData } from "../types/storage";

/** 当前仓储支持的数据结构版本 */
export const CURRENT_SCHEMA_VERSION = 1;

/** 判断未知值是否为可读取键值的普通对象 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断持久化数据是否至少具备考勤记录的关键边界 */
function isAttendanceRecord(value: unknown): value is AttendanceRecord {
  return isObject(value)
    && typeof value.date === "string"
    && typeof value.weekday === "number"
    && typeof value.attendanceState === "string"
    && Array.isArray(value.warnings)
    && isObject(value.source);
}

/** 生成不含任何用户考勤的初始仓储数据 */
export function createDefaultPluginData(): OvertimeVisualizerData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, releaseWeekdays: [...DEFAULT_SETTINGS.releaseWeekdays] },
    records: {},
    importBatches: [],
    snapshots: [],
  };
}

/** 校验并将持久化数据迁移到当前版本，未知高版本直接阻断 */
export function migratePluginData(rawData: unknown): OvertimeVisualizerData {
  if (rawData === null || rawData === undefined) return createDefaultPluginData();
  if (!isObject(rawData)) throw new Error("插件数据格式损坏，已停止加载");
  if (typeof rawData.schemaVersion === "number" && rawData.schemaVersion > CURRENT_SCHEMA_VERSION) throw new Error("插件数据由更高版本生成，请升级插件");
  if (rawData.schemaVersion !== CURRENT_SCHEMA_VERSION || !isObject(rawData.records)) throw new Error("不支持的插件数据结构");

  /** 通过最小边界校验的考勤记录索引 */
  const records = Object.fromEntries(Object.entries(rawData.records).filter((entry): entry is [string, AttendanceRecord] => isAttendanceRecord(entry[1])));
  /** 默认值与持久化值合并得到的统计设置 */
  const settings = isObject(rawData.settings) ? { ...DEFAULT_SETTINGS, ...rawData.settings } : DEFAULT_SETTINGS;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: {
      startFloorMinute: Number(settings.startFloorMinute),
      endBenchmarkMinute: Number(settings.endBenchmarkMinute),
      overnightCutoffMinute: Number(settings.overnightCutoffMinute),
      releaseWeekdays: Array.isArray(settings.releaseWeekdays) ? settings.releaseWeekdays.filter((value): value is number => typeof value === "number") : [...DEFAULT_SETTINGS.releaseWeekdays],
    },
    records,
    importBatches: Array.isArray(rawData.importBatches) ? rawData.importBatches as OvertimeVisualizerData["importBatches"] : [],
    snapshots: Array.isArray(rawData.snapshots) ? rawData.snapshots as OvertimeVisualizerData["snapshots"] : [],
  };
}

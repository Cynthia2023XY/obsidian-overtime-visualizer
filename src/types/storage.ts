import type { OvertimeVisualizerSettings } from "../settings";
import type { AttendanceRecord, AttendanceState } from "./attendance";

/** 可快速记录的解压行为类型 */
export type ReliefActivityType = "sanlian" | "scientific-american" | "walk" | "cycling";

/** 单次解压行为的本地持久化明细 */
export interface ReliefEntry {
  id: string;
  date: string;
  type: ReliefActivityType;
  durationMinutes: number;
  createdAt: number;
}

/** 可按日期、日类型和数据状态筛选的本地查询 */
export interface AttendanceQuery {
  startDate?: string;
  endDate?: string;
  dayTypes?: AttendanceRecord["dayType"][];
  attendanceStates?: AttendanceState[];
  releaseOnly?: boolean;
  overnightOnly?: boolean;
}

/** 一次可回滚导入所保留的差异证据 */
export interface ImportBatch {
  id: string;
  importedAt: number;
  createdDates: string[];
  updatedRecords: Record<string, AttendanceRecord>;
}

/** 一次写入前用于恢复的有限本地快照 */
export interface PluginDataSnapshot {
  createdAt: number;
  settings: OvertimeVisualizerSettings;
  records: Record<string, AttendanceRecord>;
}

/** 保存在 Obsidian data.json 中的版本化插件数据 */
export interface OvertimeVisualizerData {
  schemaVersion: 3;
  settings: OvertimeVisualizerSettings;
  records: Record<string, AttendanceRecord>;
  importBatches: ImportBatch[];
  snapshots: PluginDataSnapshot[];
}

/** 独立保存在 relief-data.json 中的解压记录数据 */
export interface ReliefVisualizerData {
  schemaVersion: 1;
  entries: Record<string, ReliefEntry>;
}

/** 仓储层与 Obsidian Plugin 之间的最小持久化适配器 */
export interface PluginDataAdapter {
  loadData: () => Promise<unknown>;
  saveData: (data: OvertimeVisualizerData) => Promise<void>;
}

/** 解压记录独立文件的读写适配器 */
export interface ReliefDataAdapter {
  loadReliefData: () => Promise<unknown>;
  saveReliefData: (data: ReliefVisualizerData) => Promise<void>;
}

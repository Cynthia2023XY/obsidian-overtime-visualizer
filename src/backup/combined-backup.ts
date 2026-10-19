import type { AttendanceRecord } from "../types/attendance";
import type { ReliefEntry, ImportBatch } from "../types/storage";
import { DEFAULT_SETTINGS, type OvertimeVisualizerSettings } from "../settings";
import type { PluginDataRepository } from "../repository/plugin-data-repository";

/** 合并备份同时保存出勤事实、解压行为和计算配置，避免恢复后历史分数变化 */
export interface CombinedBackup {
    format: "overtime-visualizer-backup";
    version: 1;
    exportedAt: string;
    attendance: AttendanceRecord[];
    relief: ReliefEntry[];
    settings: OvertimeVisualizerSettings;
}

/** 判断导入字段是否为可安全读取的普通对象 */
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验日期确实存在，拒绝无效月份和自动溢出的日期 */
function isDate(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** 校验业务计算所需的有限非负数 */
function isNonNegative(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 校验打卡分钟，允许空打卡以及次日凌晨的跨夜时间 */
function isMinute(value: unknown): boolean {
    return value === null || (isNonNegative(value) && Number.isInteger(value) && value < 2880);
}

/** 校验合并备份中的完整考勤事实，避免损坏数据进入计算层 */
function isAttendance(value: unknown): value is AttendanceRecord {
    return isObject(value) && isDate(value.date)
        && typeof value.weekday === "number" && Number.isInteger(value.weekday) && value.weekday >= 1 && value.weekday <= 7
        && ["workday", "rest-day", "holiday", "unknown"].includes(String(value.dayType))
        && isMinute(value.startMinute) && isMinute(value.endMinute)
        && ["complete", "non-working-day", "full-leave", "partial-leave", "missing-punch", "incomplete", "ambiguous-start"].includes(String(value.attendanceState))
        && ["none", "confirmed", "linked", "ambiguous"].includes(String(value.overnightState))
        && typeof value.isReleaseDay === "boolean" && typeof value.manuallyEdited === "boolean"
        && Array.isArray(value.leaveReasons) && value.leaveReasons.every((item) => typeof item === "string")
        && Array.isArray(value.warnings) && value.warnings.every((item) => typeof item === "string")
        && isObject(value.source) && typeof value.source.attendanceDay === "string"
        && ["attendanceStartTime", "attendanceEndTime", "weekDay", "workDayType", "applyReason", "attendanceStatus"].every((key) => value.source !== null && isObject(value.source) && (value.source[key] === null || typeof value.source[key] === "string"));
}

/** 校验解压明细并限制为插件已知的稳定事项类型 */
function isRelief(value: unknown): value is ReliefEntry {
    return isObject(value) && typeof value.id === "string" && value.id.length > 0 && !["__proto__", "constructor", "prototype"].includes(value.id) && isDate(value.date)
        && DEFAULT_SETTINGS.reliefActivities.some((activity) => activity.type === value.type)
        && isNonNegative(value.durationMinutes) && value.durationMinutes > 0 && isNonNegative(value.createdAt);
}

/** 校验完整统计配置，拒绝无效分值、重复事项和超出范围的规则 */
function isSettings(value: unknown): value is OvertimeVisualizerSettings {
    return isObject(value)
        && ["startFloorMinute", "endBenchmarkMinute", "overnightCutoffMinute"].every((key) => isNonNegative(value[key]) && Number(value[key]) < 2880)
        && Array.isArray(value.releaseWeekdays) && value.releaseWeekdays.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7)
        && Array.isArray(value.reliefActivities) && value.reliefActivities.length === DEFAULT_SETTINGS.reliefActivities.length
        && value.reliefActivities.every((activity) => isObject(activity)
            && DEFAULT_SETTINGS.reliefActivities.some((definition) => definition.type === activity.type)
            && typeof activity.name === "string" && isNonNegative(activity.score)
            && (activity.enabled === undefined || typeof activity.enabled === "boolean")
            && (activity.durationMinutes === undefined || (isNonNegative(activity.durationMinutes) && activity.durationMinutes > 0)))
        && new Set(value.reliefActivities.map((activity: Record<string, unknown>) => activity.type)).size === value.reliefActivities.length;
}

/** 创建包含全部本地记录的合并备份，页面筛选不影响导出范围 */
export function createCombinedBackup(repository: PluginDataRepository): CombinedBackup {
    return { format: "overtime-visualizer-backup", version: 1, exportedAt: new Date().toISOString(), attendance: repository.list(), relief: repository.listReliefEntries(), settings: repository.getSettings() };
}

/** 自动识别合并 JSON，旧考勤或 Markdown 输入返回空值并继续原有导入流程 */
export function parseCombinedBackup(text: string): CombinedBackup | null {
    // 未识别为合并备份的输入由原有考勤解析器处理
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { return null; }
    if (!isObject(value) || value.format !== "overtime-visualizer-backup") return null;
    if (value.version !== 1) throw new Error("不支持此合并备份版本，请升级插件后重试");
    if (typeof value.exportedAt !== "string" || !isSettings(value.settings)
        || !Array.isArray(value.attendance) || !value.attendance.every(isAttendance)
        || !Array.isArray(value.relief) || !value.relief.every(isRelief)) throw new Error("合并备份存在无效考勤、解压明细或配置，未写入任何数据");
    if (new Set(value.attendance.map((record) => record.date)).size !== value.attendance.length
        || new Set(value.relief.map((entry) => entry.id)).size !== value.relief.length) throw new Error("合并备份包含重复日期或解压记录 ID，请先检查文件");
    return { format: "overtime-visualizer-backup", version: 1, exportedAt: value.exportedAt, attendance: value.attendance, relief: value.relief, settings: value.settings };
}

/** 统一导入两类记录与配置；后续写入失败时撤回先前已写入的考勤和配置 */
export async function importCombinedBackup(repository: PluginDataRepository, backup: CombinedBackup): Promise<void> {
    // 写入前再次校验，保证直接调用也无法绕过文件完整性检查
    if (!parseCombinedBackup(JSON.stringify(backup))) throw new Error("无法识别合并备份");
    // 保留原设置以便导入失败时恢复
    const previousSettings = repository.getSettings();
    // 本次考勤写入批次用于失败时恢复被覆盖或新增的日期
    let batch: ImportBatch | null = null;
    // 仅在设置实际写入成功后执行对应恢复
    let settingsWritten = false;
    try {
        await repository.updateSettings(backup.settings);
        settingsWritten = true;
        if (backup.attendance.length) batch = await repository.importBatch(backup.attendance);
        if (backup.relief.length) await repository.importReliefEntries(backup.relief);
    } catch (error) {
        try {
            if (batch && !await repository.restoreBatch(batch.id)) throw new Error("找不到待恢复的考勤批次");
            if (settingsWritten) await repository.updateSettings(previousSettings);
        } catch {
            throw new Error("合并导入失败且回滚未完成，请保留备份文件并检查本地数据后重试");
        }
        throw new Error(`合并导入失败，已恢复原考勤和配置：${error instanceof Error ? error.message : String(error)}`);
    }
}

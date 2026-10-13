import { App, Modal, Notice, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import { createReliefActivityDefinitions } from "../analytics/pressure-ledger";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import type { AttendanceRecord } from "../types/attendance";
import type { ReliefActivityType, ReliefEntry } from "../types/storage";

/** 将 HH:mm 文本转换为当日分钟数 */
function parseClock(value: string): number | null {
  /** 小时和分钟两部分的格式匹配 */
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  /** 用户输入的小时数 */
  const hour = Number(match[1]);
  /** 用户输入的分钟数 */
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 47 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

/** 将分钟数格式化为可编辑的 HH:mm 文本 */
function formatClock(value: number | null): string {
  if (value === null) return "";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** 编辑单条考勤的上班和下班时间 */
export class AttendanceEditModal extends Modal {
  /** 创建考勤编辑弹窗 */
  constructor(app: App, private readonly repository: PluginDataRepository, private readonly record: AttendanceRecord, private readonly onSaved: () => void) {
    super(app);
  }

  /** 渲染时间表单并持久化更改 */
  onOpen(): void {
    this.setTitle(`编辑考勤·${this.record.date}`);
    /** 当前编辑中的上班时间文本 */
    let startValue = formatClock(this.record.startMinute);
    /** 当前编辑中的下班时间文本 */
    let endValue = formatClock(this.record.endMinute);
    new Setting(this.contentEl).setName("上班时间").setDesc("24 小时格式，例如 09:00").addText((text) => text.setValue(startValue).onChange((value) => { startValue = value; }));
    new Setting(this.contentEl).setName("下班时间").setDesc("跨夜可填 24:00 以上").addText((text) => text.setValue(endValue).onChange((value) => { endValue = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close())).addButton((button) => button.setCta().setButtonText("保存").onClick(async () => {
      /** 校验后的上班分钟数 */
      const startMinute = parseClock(startValue);
      /** 校验后的下班分钟数 */
      const endMinute = parseClock(endValue);
      if (startMinute === null || endMinute === null) { new Notice("请输入有效的时间"); return; }
      await this.repository.upsert({ ...this.record, startMinute, endMinute, manuallyEdited: true, source: { ...this.record.source, attendanceStartTime: startValue, attendanceEndTime: endValue } });
      this.onSaved();
      this.close();
    }));
  }
}

/** 按日期补录或修正考勤事实，并由时间字段推导完整状态 */
export class DailyAttendanceModal extends Modal {
  /** 创建指定日期的考勤编辑弹窗 */
  constructor(app: App, private readonly repository: PluginDataRepository, private readonly date: string, private readonly onSaved: () => void) { super(app); }

  /** 展示可保留缺失打卡的日期考勤表单 */
  onOpen(): void {
    this.setTitle(`每日考勤 · ${this.date}`);
    // 当前日期已经保存的考勤记录
    const existing = this.repository.get(this.date);
    // 开始时间可留空以表达未打卡
    let startValue = formatClock(existing?.startMinute ?? null);
    // 结束时间可留空以表达未打卡
    let endValue = formatClock(existing?.endMinute ?? null);
    // 人工确认的工作日类别
    let dayType = existing?.dayType ?? "workday";
    new Setting(this.contentEl).setName("上班时间").setDesc("例如 09:00；未打卡时留空").addText((text) => text.setValue(startValue).onChange((value) => { startValue = value; }));
    new Setting(this.contentEl).setName("下班时间").setDesc("可留空；跨夜时间可填 24:30 表示次日 00:30").addText((text) => text.setValue(endValue).onChange((value) => { endValue = value; }));
    new Setting(this.contentEl).setName("日类型").addDropdown((dropdown) => dropdown.addOption("workday", "工作日").addOption("rest-day", "休息日").addOption("holiday", "节假日").addOption("unknown", "待确认").setValue(dayType).onChange((value) => { dayType = value as typeof dayType; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close())).addButton((button) => button.setCta().setButtonText("保存").onClick(async () => {
      // 空白字段保留为缺失值，避免捏造打卡事实
      const startMinute = startValue.trim() ? parseClock(startValue) : null;
      // 空白字段保留为缺失值，避免捏造打卡事实
      const endMinute = endValue.trim() ? parseClock(endValue) : null;
      if ((startValue.trim() && startMinute === null) || (endValue.trim() && endMinute === null)) { new Notice("请输入有效的时间"); return; }
      if (startMinute !== null && endMinute !== null && endMinute <= startMinute) { new Notice("下班时间应晚于上班时间；跨夜请使用次日 00:xx 的 24:xx 表达"); return; }
      // 由日期、打卡和假别事实推导本次记录状态
      const attendanceState = startMinute !== null && endMinute !== null ? (existing?.leaveReasons.length ? "partial-leave" : "complete") : (startMinute !== null || endMinute !== null) ? "incomplete" : dayType === "workday" ? "missing-punch" : existing?.leaveReasons.length ? "full-leave" : "non-working-day";
      // 当前日期的 ISO 星期编号
      const weekday = new Date(`${this.date}T00:00:00Z`).getUTCDay() || 7;
      // 下班分钟超过当日范围时标记为人工确认跨夜
      const overnightState = endMinute !== null && endMinute >= 1440 ? "confirmed" : "none";
      // 保留导入快照，其余字段记录本次人工修正事实
      const source = { ...(existing?.source ?? { attendanceDay: this.date.replace(/-/g, "."), weekDay: null, workDayType: null, applyReason: null, attendanceStatus: null }), attendanceStartTime: startValue.trim() || null, attendanceEndTime: endValue.trim() || null, workDayType: dayType === "workday" ? "工作日" : dayType === "rest-day" ? "休息日" : dayType === "holiday" ? "假日" : null };
      await this.repository.upsert({ date: this.date, weekday, dayType, startMinute, endMinute, attendanceState, overnightState, isReleaseDay: existing?.isReleaseDay ?? this.repository.getSettings().releaseWeekdays.includes(weekday), leaveReasons: existing?.leaveReasons ?? [], warnings: [], source, manuallyEdited: true });
      this.onSaved();
      this.close();
    }));
  }
}

/** 编辑单条解压明细的日期、事项和次数 */
export class ReliefEditModal extends Modal {
  /** 创建解压明细编辑弹窗 */
  constructor(app: App, private readonly repository: PluginDataRepository, private readonly entry: ReliefEntry, private readonly onSaved: () => void) { super(app); }

  /** 渲染解压明细表单 */
  onOpen(): void {
    this.setTitle("编辑解压明细");
    /** 当前编辑中的归属日期 */
    let date = this.entry.date;
    /** 当前编辑中的解压行为类型 */
    let type: ReliefActivityType = this.entry.type;
    /** 用户当前的解压事项配置 */
    const definitions = createReliefActivityDefinitions(this.repository.getSettings().reliefActivities, true);
    /** 当前编辑中的解压记录次数 */
    let count = this.entry.durationMinutes / (definitions.find((definition) => definition.type === type)?.incrementMinutes ?? this.entry.durationMinutes);
    new Setting(this.contentEl).setName("日期").addText((text) => { text.inputEl.type = "date"; text.setValue(date).onChange((value) => { date = value; }); });
    new Setting(this.contentEl).setName("解压事项").addDropdown((dropdown) => {
      definitions.forEach((definition) => { dropdown.addOption(definition.type, definition.label); });
      dropdown.setValue(type).onChange((value) => { type = value as ReliefActivityType; });
    });
    new Setting(this.contentEl).setName("次数").addText((text) => { text.inputEl.type = "number"; text.inputEl.min = "0.1"; text.inputEl.step = "0.1"; text.setValue(String(count)).onChange((value) => { count = Number(value); }); });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close())).addButton((button) => button.setCta().setButtonText("保存").onClick(async () => {
      /** 选中事项对应的标准单次时长 */
      const duration = definitions.find((definition) => definition.type === type)?.incrementMinutes ?? 1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(count) || count <= 0) { new Notice("请检查日期和次数"); return; }
      await this.repository.updateReliefEntry({ ...this.entry, date, type, durationMinutes: duration * count });
      this.onSaved();
      this.close();
    }));
  }
}

/** 从 JSON 文件导入解压明细 */
export async function importReliefFile(file: File, repository: PluginDataRepository): Promise<number> {
  /** 从文件解析得到的未知 JSON 数据 */
  const parsed = JSON.parse(await file.text()) as unknown;
  /** 兼容数组和导出对象的候选记录 */
  const candidates = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && "entries" in parsed ? Object.values((parsed as { entries: Record<string, unknown> }).entries) : [];
  /** 通过最小完整性校验的解压记录 */
  const entries = candidates.filter((value): value is ReliefEntry => typeof value === "object" && value !== null && typeof (value as ReliefEntry).id === "string" && typeof (value as ReliefEntry).date === "string" && typeof (value as ReliefEntry).durationMinutes === "number" && typeof (value as ReliefEntry).createdAt === "number" && DEFAULT_SETTINGS.reliefActivities.some((activity) => activity.type === (value as ReliefEntry).type));
  if (entries.length === 0) throw new Error("文件中没有有效的解压明细");
  await repository.importReliefEntries(entries);
  return entries.length;
}

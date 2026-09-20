import { App, Modal, Notice, Setting } from "obsidian";
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
    const definitions = createReliefActivityDefinitions(this.repository.getSettings().reliefActivities);
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
  const entries = candidates.filter((value): value is ReliefEntry => typeof value === "object" && value !== null && typeof (value as ReliefEntry).id === "string" && typeof (value as ReliefEntry).date === "string" && typeof (value as ReliefEntry).durationMinutes === "number" && typeof (value as ReliefEntry).createdAt === "number" && ["sanlian", "scientific-american", "walk", "cycling"].includes((value as ReliefEntry).type));
  if (entries.length === 0) throw new Error("文件中没有有效的解压明细");
  await repository.importReliefEntries(entries);
  return entries.length;
}

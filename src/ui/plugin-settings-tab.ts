import { PluginSettingTab, Setting } from "obsidian";
import type OvertimeVisualizerPlugin from "../main";

/** 提供解压事项名称和分数编辑能力的 Obsidian 设置页 */
export class OvertimeVisualizerSettingTab extends PluginSettingTab {
  /** 创建设置页并持有插件仓储访问能力 */
  constructor(private readonly plugin: OvertimeVisualizerPlugin) {
    super(plugin.app, plugin);
  }

  /** 渲染所有可配置的今日解压快捷项 */
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("今日解压").setHeading();
    this.containerEl.createEl("p", { text: "固定提供 4 个解压事项，不支持新增或删除。如需记录新的解压事项，请直接修改现有事项的名称和单次解压分数。" });

    /** 当前仓储中可独立编辑的设置副本 */
    const settings = this.plugin.repository.getSettings();
    settings.reliefActivities.forEach((activity, index) => {
      /** 用于区分各解压快捷项的设置行 */
      const setting = new Setting(this.containerEl).setName(`解压事项 ${index + 1}`);
      setting.addText((text) => text
        .setPlaceholder("例如：看三联周刊30分钟")
        .setValue(activity.name)
        .onChange(async (value) => {
          if (!value.trim()) return;
          activity.name = value.trim();
          await this.plugin.repository.updateSettings(settings);
          this.plugin.refreshDashboard();
        }));
      setting.addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.step = "0.1";
        text.setPlaceholder("分数").setValue(String(activity.score)).onChange(async (value) => {
          /** 通过有限数校验的单次解压分数 */
          const score = Number(value);
          if (!Number.isFinite(score) || score < 0) return;
          activity.score = score;
          await this.plugin.repository.updateSettings(settings);
          this.plugin.refreshDashboard();
        });
      });
    });
  }
}

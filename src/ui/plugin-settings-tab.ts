import { Notice, PluginSettingTab, Setting, type ToggleComponent, type ButtonComponent, type SettingDefinitionItem } from "obsidian";
import type OvertimeVisualizerPlugin from "../main";
import { createReliefActivityDefinitions } from "../analytics/pressure-ledger";

/** 支持启用一至八个独立解压事项，保留停用事项的历史记录 */
export class OvertimeVisualizerSettingTab extends PluginSettingTab {
  /** 本次设置会话中用户展开的事项，重绘时保留编辑位置 */
  private readonly expandedActivities = new Set<string>();

  /** 注入插件仓储与页面刷新能力 */
  constructor(private readonly plugin: OvertimeVisualizerPlugin) { super(plugin.app, plugin); }

  /** 新版宿主通过定义索引配置，仍使用独立保存表单避免自动提交其他事项 */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: "解压事项",
      desc: "启用、事项名称、每次时长（分钟）、每次解压分；按事项独立保存。",
      aliases: this.plugin.repository.getSettings().reliefActivities.map((activity) => activity.name),
      render: (setting) => { this.renderSettings(setting.settingEl); },
    }, {
      name: "考勤自动同步",
      desc: "从笔记库中的抓取文件定时导入考勤。",
      render: (setting) => { setting.settingEl.empty(); setting.settingEl.addClass("otv-sync-settings-host"); this.renderSyncSettings(setting.settingEl); },
    }];
  }

  /** 旧版宿主继续展示相同表单，保持最低支持版本不变 */
  display(): void { this.renderSettings(this.containerEl); this.renderSyncSettings(this.containerEl); }

  /** 配置本地抓取文件和自动读取开关 */
  private renderSyncSettings(container: HTMLElement): void {
    // 独立分组避免宿主将表单的多个子项压缩在同一个设置行内
    const section = container.createDiv({ cls: "otv-sync-settings" });
    new Setting(section).setName("考勤自动同步").setHeading();
    section.createEl("p", { text: "启用后每 4 小时检查笔记库内的脱敏考勤文件，并在启动时检查一次。抓取任务独立运行；请留意该文件可能随笔记库同步。" });
    // 以完整宽度展示可编辑路径，避免被操作按钮挤压
    const pathField = section.createEl("label", { cls: "otv-sync-path-field" });
    pathField.createSpan({ text: "同步文件路径" });
    const input = pathField.createEl("input", { type: "text", value: this.plugin.syncSettings.path });
    input.setAttribute("aria-label", "考勤同步文件相对路径");
    pathField.createEl("small", { text: "填写相对于当前笔记库的 JSON 文件路径，修改后点击保存。" });
    new Setting(section).setName("自动读取考勤文件").addToggle((toggle) => toggle.setValue(this.plugin.syncSettings.enabled).onChange(async (enabled) => {
      try { await this.plugin.saveSyncSettings({ enabled, path: input.value }); }
      catch (error) { toggle.setValue(this.plugin.syncSettings.enabled); new Notice(error instanceof Error ? error.message : "同步设置保存失败"); }
    }));
    new Setting(section).setName("同步操作")
      .addButton((button) => button.setButtonText("保存路径").onClick(async () => {
        try { await this.plugin.saveSyncSettings({ enabled: this.plugin.syncSettings.enabled, path: input.value }); new Notice("考勤同步路径已保存"); }
        catch (error) { new Notice(error instanceof Error ? error.message : "同步设置保存失败"); }
      })).addButton((button) => button.setButtonText("立即同步").onClick(() => void this.plugin.syncAttendanceFile()));
  }

  /** 两种宿主入口共享同一表单和保存行为 */
  private renderSettings(container: HTMLElement): void {
    container.empty();
    container.addClass("otv-relief-settings");
    new Setting(container).setName("解压事项").setHeading();
    container.createEl("p", { text: "可启用 1–8 项。停用只隐藏快捷入口，历史记录仍保留并参与统计。启用开关即时生效；名称、时长和分数修改后，在对应事项内点击“保存此事项”。" });
    // 独立编辑副本，保存前不改变看板
    const settings = this.plugin.repository.getSettings();
    // 保存过程中同步禁用所有开关，避免并发覆盖配置
    const toggles: ToggleComponent[] = [];
    // 手动保存按钮与启用开关共享写入锁
    const saveButtons: ButtonComponent[] = [];
    // 当前是否有配置正在写入
    let saving = false;
    // 统一控制写入期间的交互状态
    const setSaving = (busy: boolean): void => {
      saving = busy;
      toggles.forEach((toggle) => { toggle.setDisabled(busy); });
      saveButtons.forEach((button) => { button.setDisabled(busy); });
    };
    // 用于兼容旧事项时长的完整定义
    const definitions = createReliefActivityDefinitions(settings.reliefActivities, true);
    // 全部事项的展开与收起操作
    new Setting(container).setName("配置详情").addButton((button) => button.setButtonText("全部展开").onClick(() => {
      container.querySelectorAll<HTMLDetailsElement>(".otv-relief-setting-card").forEach((card) => { card.open = true; });
    })).addButton((button) => button.setButtonText("全部收起").onClick(() => {
      container.querySelectorAll<HTMLDetailsElement>(".otv-relief-setting-card").forEach((card) => { card.open = false; });
    }));
    settings.reliefActivities.forEach((activity, index) => {
      // 每项独立卡片，避免默认设置行挤压标题
      const card = container.createEl("details", { cls: "otv-relief-setting-card" });
      card.open = this.expandedActivities.has(activity.type);
      card.ontoggle = () => { if (card.open) this.expandedActivities.add(activity.type); else this.expandedActivities.delete(activity.type); };
      // 折叠状态仍可识别事项名称与当前启用状态
      const summary = card.createEl("summary", { cls: "otv-relief-setting-summary" });
      summary.createSpan({ cls: "otv-relief-setting-index", text: `事项 ${index + 1}` });
      // 编辑名称后同步折叠摘要
      const summaryName = summary.createEl("strong", { text: activity.name });
      // 编辑开关后同步状态标记
      const summaryStatus = summary.createSpan({ cls: "otv-relief-setting-status", text: activity.enabled !== false ? "已启用" : "已停用" });
      // 展开后显示开关和表单，避免点击控件意外触发折叠
      const content = card.createDiv({ cls: "otv-relief-setting-content" });
      // 标题与启用开关拥有独立的一行
      const header = new Setting(content).setName("启用此事项").setDesc(activity.enabled !== false ? "已启用" : "已停用，保留历史记录");
      header.settingEl.addClass("otv-relief-setting-header");
      header.addToggle((toggle) => {
        toggle.toggleEl.setAttribute("aria-label", `启用事项 ${index + 1}`);
        toggles.push(toggle);
        toggle.setValue(activity.enabled !== false).onChange(async (enabled) => {
          if (saving) { toggle.setValue(activity.enabled !== false); return; }
          setSaving(true);
          // 只修改已持久化配置的启用状态，不提交尚未保存的表单内容
          const persisted = this.plugin.repository.getSettings();
          // 按稳定标识定位事项，避免顺序变化影响其他事项
          const target = persisted.reliefActivities.find((item) => item.type === activity.type);
          // 保存失败时恢复最近一次成功保存的状态
          const previous = target?.enabled !== false;
          header.setDesc("正在保存…");
          try {
            if (!target) throw new Error("解压事项不存在，请重新打开设置页");
            target.enabled = enabled;
            await this.plugin.repository.updateSettings(persisted);
            activity.enabled = enabled;
            summaryStatus.setText(enabled ? "已启用" : "已停用");
            header.setDesc(enabled ? "已启用" : "已停用，保留历史记录");
            this.plugin.refreshDashboard();
          } catch (error) {
            activity.enabled = previous;
            toggle.setValue(previous);
            summaryStatus.setText(previous ? "已启用" : "已停用");
            header.setDesc(previous ? "已启用" : "已停用，保留历史记录");
            new Notice(error instanceof Error ? error.message : "启用状态保存失败");
          } finally { setSaving(false); }
        });
      });
      // 名称、时长和分数的自适应字段网格
      const fields = content.createDiv({ cls: "otv-relief-setting-fields" });
      // 名称输入与可见标签绑定
      const nameLabel = fields.createEl("label", { cls: "otv-relief-setting-field otv-relief-setting-name" });
      nameLabel.createSpan({ text: "事项名称" });
      // 保留完整名称的输入框
      const nameInput = nameLabel.createEl("input", { type: "text", value: activity.name, placeholder: "例如：阅读" });
      nameInput.setAttribute("aria-label", `事项 ${index + 1} 名称`);
      nameInput.oninput = () => { activity.name = nameInput.value.trim(); summaryName.setText(activity.name || "未命名事项"); };
      // 分钟数输入与单位标签
      const durationLabel = fields.createEl("label", { cls: "otv-relief-setting-field" });
      durationLabel.createSpan({ text: "每次时长（分钟）" });
      // 默认值沿用历史事项的计分时长
      const durationInput = durationLabel.createEl("input", { type: "number", value: String(activity.durationMinutes ?? definitions[index]?.incrementMinutes ?? 30) });
      durationInput.min = "1";
      durationInput.step = "1";
      durationInput.setAttribute("aria-label", `事项 ${index + 1} 每次分钟数`);
      durationInput.oninput = () => { activity.durationMinutes = durationInput.value.trim() ? Number(durationInput.value) : NaN; };
      // 分数输入与明确的单次单位
      const scoreLabel = fields.createEl("label", { cls: "otv-relief-setting-field" });
      scoreLabel.createSpan({ text: "每次解压分" });
      // 支持小数的计分输入
      const scoreInput = scoreLabel.createEl("input", { type: "number", value: String(activity.score) });
      scoreInput.min = "0";
      scoreInput.step = "0.1";
      scoreInput.setAttribute("aria-label", `事项 ${index + 1} 每次分数`);
      scoreInput.oninput = () => { activity.score = scoreInput.value.trim() ? Number(scoreInput.value) : NaN; };
      // 保存入口紧邻本事项表单，只提交当前事项的编辑字段
      new Setting(content).addButton((button) => {
        saveButtons.push(button);
        button.buttonEl.setAttribute("aria-label", `保存事项 ${index + 1}`);
        button.setButtonText("保存此事项").setCta().onClick(async () => {
          if (saving) return;
          setSaving(true);
          try {
            // 从最近成功保存的配置合并当前事项，保留其他事项和即时开关状态
            const persisted = this.plugin.repository.getSettings();
            // 稳定事项标识决定本次写入目标
            const target = persisted.reliefActivities.find((item) => item.type === activity.type);
            if (!target) throw new Error("解压事项不存在，请重新打开设置页");
            target.name = activity.name;
            target.score = activity.score;
            target.durationMinutes = activity.durationMinutes;
            await this.plugin.repository.updateSettings(persisted);
            this.plugin.refreshDashboard();
            new Notice(`“${target.name}”已保存`);
          } catch (error) { new Notice(error instanceof Error ? error.message : "保存失败"); }
          finally { setSaving(false); }
        });
      });
    });
  }
}

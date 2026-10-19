/**
 * @projectDoc
 * # 项目访问路径
 *
 * ## Obsidian 插件信息
 * - 开发目录：`obsidian-overtime-visualizer`
 * - 笔记库安装路径：`<Vault>/.obsidian/plugins/obsidian-overtime-visualizer/`
 * - 主命令：`打开加班时长仪表盘`
 */
import { normalizePath, Plugin, WorkspaceLeaf } from "obsidian";
import {
  ATTENDANCE_DATA_VIEW_TYPE,
  OVERTIME_DASHBOARD_DISPLAY_NAME,
  OVERTIME_DASHBOARD_VIEW_TYPE,
} from "./constants";
import { AttendanceDashboardView } from "./views/attendance-dashboard-view";
import { PluginDataRepository } from "./repository/plugin-data-repository";
import { AttendanceDataView } from "./views/attendance-data-view";
import type { ReliefVisualizerData } from "./types/storage";
import { OvertimeVisualizerSettingTab } from "./ui/plugin-settings-tab";
import { createCombinedBackup } from "./backup/combined-backup";
import { exportJson } from "./export/json-export";

/** 加班时长可视化插件入口，负责生命周期和功能注册 */
export default class OvertimeVisualizerPlugin extends Plugin {
  /** 已通过版本校验的本地考勤仓储 */
  repository: PluginDataRepository;

  /** 创建插件并将 Obsidian 持久化 API 注入考勤仓储 */
  constructor(app: ConstructorParameters<typeof Plugin>[0], manifest: ConstructorParameters<typeof Plugin>[1]) {
    super(app, manifest);
    this.repository = new PluginDataRepository(this, {
      loadReliefData: async () => {
        /** 解压记录独立文件在笔记库中的相对路径 */
        const path = this.getReliefDataPath();
        if (!await this.app.vault.adapter.exists(path)) return null;
        return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
      },
      saveReliefData: async (data: ReliefVisualizerData) => {
        await this.app.vault.adapter.write(this.getReliefDataPath(), JSON.stringify(data, null, 2));
      },
    });
  }

  /** 返回插件目录中独立解压数据文件的路径 */
  private getReliefDataPath(): string {
    /** 当前插件的笔记库内安装目录 */
    const pluginDirectory = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    return normalizePath(`${pluginDirectory}/relief-data.json`);
  }

  /** 插件启用时注册仪表盘视图、命令和侧边栏入口 */
  async onload(): Promise<void> {
    await this.repository.initialize();
    this.addSettingTab(new OvertimeVisualizerSettingTab(this));

    this.registerView(
      OVERTIME_DASHBOARD_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AttendanceDashboardView(leaf, this.repository),
    );
    this.registerView(
      ATTENDANCE_DATA_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AttendanceDataView(leaf, this.repository),
    );

    this.addRibbonIcon(
      "clock-3",
      OVERTIME_DASHBOARD_DISPLAY_NAME,
      () => void this.activateDashboard(),
    );

    this.addCommand({
      id: "open-overtime-dashboard",
      name: "打开加班时长仪表盘",
      callback: () => void this.activateDashboard(),
    });

    this.addCommand({
      id: "export-combined-backup",
      name: "导出考勤与解压合并备份",
      callback: () => void exportJson(this.app, "考勤与解压备份", createCombinedBackup(this.repository)),
    });

    this.addCommand({
      id: "export-sanitized-attendance-backup",
      name: "导出脱敏考勤备份",
      callback: () => void this.exportSanitizedBackup(),
    });

    this.addCommand({
      id: "open-attendance-data",
      name: "打开考勤数据管理",
      callback: () => void this.activateAttendanceData(),
    });
  }

  /** 当设置改变时刷新已打开的仪表盘 */
  refreshDashboard(): void {
    this.app.workspace.getLeavesOfType(ATTENDANCE_DATA_VIEW_TYPE).forEach((leaf) => { if (leaf.view instanceof AttendanceDataView) void leaf.view.refresh(); });
    this.app.workspace.getLeavesOfType(OVERTIME_DASHBOARD_VIEW_TYPE).forEach((leaf) => {
      /** 当前工作区叶子中的仪表盘视图 */
      const view = leaf.view;
      if (view instanceof AttendanceDashboardView) void view.refresh();
    });
  }

  /** 打开或聚焦唯一的加班时长仪表盘 */
  private async activateDashboard(): Promise<void> {
    /** 当前已打开的仪表盘视图 */
    const existingLeaves = this.app.workspace.getLeavesOfType(
      OVERTIME_DASHBOARD_VIEW_TYPE,
    );

    /** 需要打开或聚焦的工作区叶子 */
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");

    if (existingLeaves.length === 0) {
      await leaf.setViewState({
        type: OVERTIME_DASHBOARD_VIEW_TYPE,
        active: true,
      });
    }

    await this.app.workspace.revealLeaf(leaf);
  }

  /** 打开或聚焦唯一的考勤数据管理视图 */
  private async activateAttendanceData(): Promise<void> {
    /** 当前已打开的数据管理视图 */
    const existingLeaves = this.app.workspace.getLeavesOfType(ATTENDANCE_DATA_VIEW_TYPE);
    /** 需要打开或聚焦的工作区叶子 */
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");
    if (existingLeaves.length === 0) {
      await leaf.setViewState({ type: ATTENDANCE_DATA_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /** 将可重新导入的白名单考勤字段导出到默认下载目录 */
  private async exportSanitizedBackup(): Promise<void> {
    // 导出时间同时保存在备份正文，便于确认数据版本
    const exportedAt = new Date().toISOString();
    await exportJson(this.app, "考勤脱敏备份", {
      exportedAt,
      body: { list: this.repository.list().reverse().map((record) => record.source) },
    });
  }
}

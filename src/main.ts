/**
 * @projectDoc
 * # 项目访问路径
 *
 * ## Obsidian 插件信息
 * - 开发目录：`obsidian-overtime-visualizer`
 * - 笔记库安装路径：`<Vault>/.obsidian/plugins/obsidian-overtime-visualizer/`
 * - 主命令：`打开加班时长仪表盘`
 */
import { normalizePath, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import {
  ATTENDANCE_DATA_VIEW_TYPE,
  OVERTIME_DASHBOARD_DISPLAY_NAME,
  OVERTIME_DASHBOARD_VIEW_TYPE,
} from "./constants";
import { AttendanceDashboardView } from "./views/attendance-dashboard-view";
import { PluginDataRepository } from "./repository/plugin-data-repository";
import { AttendanceDataView } from "./views/attendance-data-view";

/** 加班时长可视化插件入口，负责生命周期和功能注册 */
export default class OvertimeVisualizerPlugin extends Plugin {
  /** 已通过版本校验的本地考勤仓储 */
  repository: PluginDataRepository;

  /** 创建插件并将 Obsidian 持久化 API 注入考勤仓储 */
  constructor(app: ConstructorParameters<typeof Plugin>[0], manifest: ConstructorParameters<typeof Plugin>[1]) {
    super(app, manifest);
    this.repository = new PluginDataRepository(this);
  }

  /** 插件启用时注册仪表盘视图、命令和侧边栏入口 */
  async onload(): Promise<void> {
    await this.repository.initialize();

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

  /** 将可重新导入的白名单考勤字段导出到笔记库备份目录 */
  private async exportSanitizedBackup(): Promise<void> {
    try {
      /** 笔记库内集中保存脱敏备份的目录 */
      const backupDirectory = normalizePath("加班时长备份");
      if (!this.app.vault.getAbstractFileByPath(backupDirectory)) {
        await this.app.vault.createFolder(backupDirectory);
      }

      /** 用于避免备份文件重名的本地导出时刻 */
      const exportedAt = new Date();
      /** 不含文件系统非法冒号的备份时间戳 */
      const timestamp = exportedAt.toISOString().replace(/[:.]/g, "-");
      /** 当前所有记录中可重新导入的脱敏原始字段 */
      const sanitizedItems = this.repository.list().reverse().map((record) => record.source);
      /** 与普通考勤 JSON 使用相同解包格式的备份内容 */
      const backupContent = JSON.stringify({
        exportedAt: exportedAt.toISOString(),
        body: { list: sanitizedItems },
      }, null, 2);
      /** 本次脱敏备份在笔记库中的目标路径 */
      const backupPath = normalizePath(`${backupDirectory}/考勤脱敏备份-${timestamp}.json`);
      /** 新创建的脱敏备份文件 */
      const backupFile = await this.app.vault.create(backupPath, backupContent);
      await this.app.workspace.getLeaf("tab").openFile(backupFile);
      new Notice(`已导出 ${sanitizedItems.length} 条脱敏考勤记录`);
    } catch {
      new Notice("脱敏考勤备份导出失败，请检查笔记库写入权限");
    }
  }
}

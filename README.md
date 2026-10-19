# Overtime Visualizer

## 1.1.0 出勤趋势与合并备份

- 压力趋势和每日列表、详情只展示有打卡的日期，保留单次打卡与休息日出勤。
- 压力曲线平滑连接实际出勤日，保持原始分值。
- 顶部新增合并及单独导出入口，桌面端默认保存到下载文件夹。
- 支持考勤、解压明细和配置的一次导出与预览导入，重复导入按日期及记录 ID 合并。
- 修复桌面插件导出模块加载兼容性，失败提示展示真实原因。

## 1.0.0 年度总结与图片分享

- 提供概览、每日记录与年度回顾，以及可独立保存的解压事项配置。
- 年度分享卡增加工作日总数、七档下班时间分布及跨夜工作日统计。
- 在“年度回顾 → 分享年度总结”中点击“复制图片”，生成完整高清 PNG 并复制到剪贴板。
- 保留预览中的字体、字重、渐变和山形背景；修复记录及撤销今日解压后滚动位置复位。
- 图片在本地生成，需运行环境支持图片剪贴板；不支持时可使用系统截图。
- 第三方图片生成依赖的许可见 [Third-party notices](THIRD_PARTY_NOTICES.md)。

## 数据导出

顶部「导入考勤」旁新增「导出全部」，一次导出考勤、解压明细和统计配置到一个 JSON 文件。点击「导入考勤」选择该合并文件，预览数量后确认即可一次恢复；考勤按日期、解压按 ID 合并，相同标识以备份为准，其余记录保留，重复导入不会增加重复记录。合并备份同时恢复统计规则及解压事项配置。

仍提供「导出考勤」和「导出解压」，导出全部已保存的数据，不受页面筛选影响。桌面端默认保存到当前用户的 `Downloads`（下载）文件夹，成功后提示完整路径；命令面板备份及完整明细页也使用同一路径。移动端保留笔记库内「加班时长备份」目录。文件仍为可重新导入的 JSON。

## 考勤日期展示

- 概览压力趋势与每日记录只展示至少有一次上班或下班打卡的日期，不按工作日、休息日区分。
- 无打卡日期及仅有解压记录的日期不展示；原始考勤与解压数据仍保留。
- 每日详情与列表使用同一筛选结果，前后切换会跳过无考勤日期；压力曲线平滑连接实际出勤日期，数值不变。

## English

Overtime Visualizer is an offline-first Obsidian dashboard for reviewing late departures, overnight work, weekend attendance, and recent workload pressure from local attendance records.

### Features

- Calculates a standardized workload pressure score for the latest 30 days.
- Groups late departures into six mutually exclusive time ranges, including overnight work.
- Displays daily departure trends, reference lines, weekend markers, and a 30-day heatmap.
- Provides a dedicated attendance data management view.
- Imports attendance records from JSON files, JSON code blocks in Markdown, or pasted text.
- Previews added, updated, skipped, and invalid records before saving.
- Recognizes leave, missing punches, and overnight attendance records.
- Stores versioned data locally in the current vault and supports rolling back import batches.
- Exports a sanitized JSON backup that can be imported again.
- Supports both light and dark Obsidian themes.

### Installation

After the plugin is available in the Community Plugins directory, search for `Overtime Visualizer` under **Settings → Community plugins → Browse** and install it.

For manual installation, copy the following files into `<vault>/.obsidian/plugins/overtime-visualizer/`:

```text
main.js
manifest.json
styles.css
```

Reload Obsidian, then enable `Overtime Visualizer` in the Community plugins settings. Open the dashboard from the clock icon in the ribbon or run **Open overtime dashboard** from the command palette.

### Import format limitation

The current version only supports the internal JD attendance data format. Attendance exports from other companies, platforms, or custom systems are not supported by default. To import another format, you must develop your own parser and conversion adapter.

### Privacy

- Attendance records, relief records, and plugin settings remain in the current Obsidian vault.
- The plugin contains no telemetry, analytics, or advertising and does not upload attendance data to network services.
- Exported backups contain only allowlisted fields. Desktop exports are written to the current user’s Downloads folder; mobile exports remain in the vault’s 加班时长备份 folder.

## 中文

一个离线优先的 Obsidian 下班压力看板，用于分析晚下班、跨夜工作和周末加班。

## 安装

发布到社区插件市场后，可在 Obsidian 的 **设置 → 第三方插件 → 浏览** 中搜索 `Overtime Visualizer` 并安装。

手动安装时，将以下文件放入仓库的 `.obsidian/plugins/overtime-visualizer/` 目录：

```text
main.js
manifest.json
styles.css
```

重新加载 Obsidian 后，在第三方插件设置中启用 `Overtime Visualizer`。

## 独立应用与共享代码

桌面版已迁出插件目录，独立项目位于本机 `/Users/dingxinyi.2/Documents/practice/overtime-visualizer/`。Electron 构建与安装包在独立项目维护，插件不再依赖桌面开发工具。

统计、导入与数据迁移由 `@overtime-visualizer/core@0.1.0` 提供，通用图表和组件由 `@overtime-visualizer/ui@0.1.0` 提供。两份固定版本 tarball 随仓库保存在 `vendor/`，因此克隆本插件仓库后可独立执行 `npm ci`、测试和构建，无需旁边存在独立应用仓库。`src` 中相应目录仅保留包导出适配层；插件构建时会复制共享样式到 `styles.css`。

更新流程见 [共享包说明](vendor/README.md)。

## 数据导入限制

当前版本仅支持导入京东内部的考勤数据格式，不保证兼容其他公司、平台或自定义格式的考勤数据。如需导入其他格式，请自行开发相应的数据解析与转换适配。

## 当前进度

当前版本已经打通本地真实数据链路：

- 固定近 30 天的标准化压力分、强制升级红线和轻松、适中、疲惫、痛苦评价
- 21:00–21:29、21:30–21:59、22:00–22:59、23:00–23:29、23:30–23:59 和跨夜六档互斥指标
- 22:00 后下班的上线日归因与前 30 天压力变化
- 默认展示含今天在内近 30 天、并可自定义日期区间的每日下班时间折线图
- 带 21:00、21:30、22:00、23:00、23:30 和跨夜参考线及周末标记
- 固定近 30 天下班时间热力图
- 独立的考勤数据管理 `ItemView`
- JSON 文件、Markdown 多 JSON 代码块和粘贴文本导入
- 新增、更新、跳过、错误的写入前预览
- 隐私字段白名单清洗、请假/缺卡/跨夜识别
- Obsidian `data.json` 版本化本地存储和导入批次回滚能力
- 可通过命令面板导出可重新导入的脱敏 JSON 备份
- Obsidian 深色与浅色主题适配

## 本地开发

```bash
npm install
npm run dev
```

插件 ID 为 `overtime-visualizer`。用于本地测试的插件目录或软链接名称应与该 ID 保持一致。若源码目录不在测试笔记库中，可在笔记库的 `.obsidian/plugins/` 目录创建名为 `overtime-visualizer` 的软链接。

生产校验：

```bash
npm run test:run
npm run build
npm run lint
```

在 Obsidian 命令面板执行 **打开加班时长仪表盘**，或点击左侧栏的时钟图标。

## 隐私

- 所有考勤记录、舒缓记录和插件设置仅保存在当前 Obsidian 仓库的插件数据中。
- 插件不包含遥测、分析或广告，不会把考勤数据上传到网络服务。
- 导出的备份仅包含白名单字段；桌面端写入当前用户的 Downloads（下载）文件夹，移动端继续写入笔记库的「加班时长备份」目录。

## 发布文件

GitHub Release 的标签必须与 `manifest.json` 中的版本完全一致。每个 Release 应分别上传：

- `main.js`
- `manifest.json`
- `styles.css`

## License

[MIT](./LICENSE)

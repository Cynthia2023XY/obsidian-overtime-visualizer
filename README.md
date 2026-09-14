# Overtime Visualizer

一个离线优先的 Obsidian 下班压力看板，用于分析晚下班、跨夜工作和周末加班。

## 当前进度

当前版本已经打通本地真实数据链路：

- 固定近 30 天的轻松、适中、疲惫、痛苦评价
- 21:00 后、22:00 后、跨夜和周末加班核心指标
- 可选择月份区间的每日下班时间折线图
- 带 21:00、22:00 参考线及跨夜、周末标记
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

插件 ID 和目录名必须保持为 `obsidian-overtime-visualizer`。若源码目录不在测试笔记库中，可在笔记库的 `.obsidian/plugins/` 目录创建软链接。

生产校验：

```bash
npm run test:run
npm run build
npm run lint
```

在 Obsidian 命令面板执行 **打开加班时长仪表盘**，或点击左侧栏的时钟图标。

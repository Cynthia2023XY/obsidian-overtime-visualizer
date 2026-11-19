import { App, Modal, Notice, setIcon } from "obsidian";
import { init, use, type ECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import type { ReliefEntry } from "../types/storage";
import type { ReliefActivitySetting } from "../settings";
import { calculateDailyPressureLedger, calculateReliefScore, createReliefActivityDefinitions, summarizePressureLedger } from "../analytics/pressure-ledger";
import { calculateAnnualDepartureSummary, calculateWorkloadMetrics } from "../analytics/workload-evaluation";
import { formatLocalIsoDate, shiftIsoDate } from "../utils/date";
import { formatClockMinute } from "../utils/time";
import { ImportPreviewModal } from "./import-preview-modal";
import { DailyAttendanceModal, ReliefEditModal } from "./data-management-modals";
import { copyShareImage } from "./share-image";
import { createCombinedBackup } from "../backup/combined-backup";
import { exportJson } from "../export/json-export";
import { renderDatePicker, renderMonthPicker } from "./date-picker";
import { calculateDepartureTrend, getDepartureBridges } from "../analytics/departure-trend";
import { getAttendanceDates } from "./attendance-dates";
import { calculatePressureTrend } from "../analytics/pressure-trend";
import { formatWeekday, renderMonthDays } from "./month-calendar";
use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
/** 按原型组织三页导航、真实账本和本地编辑操作 */
export class PrototypeBoard {
    /** 当前导航页签 */
    private page: string;
    /** 当前每日详情日期 */
    private selected = "";
    /** 解压日历的选中日期，未选择时跟随本地当天 */
    private reliefDate: string | null = null;
    /** 每日记录的月份筛选 */
    private month = formatLocalIsoDate(new Date()).slice(0, 7);
    /** 每日状态筛选 */
    private filter = "全部";
    /** 每日搜索条件 */
    private search = "";
    /** 年度回顾选择的年份 */
    private year = new Date().getFullYear();
    /** 概览统计的起始日期 */
    private start = shiftIsoDate(formatLocalIsoDate(new Date()), -29);
    /** 概览统计的结束日期 */
    private end = formatLocalIsoDate(new Date());
    /** 图表实例随重绘销毁 */
    private charts: ECharts[] = [];
    /** 图表尺寸观察器 */
    private observer: ResizeObserver | null = null;
    /** 概览下方当前图表页签 */
    private chartTab = "日历热力";
    /** 月均和周均压力图各自控制是否叠加最终压力曲线 */
    private showFinalPressure = { month: false, week: false };
    /** 注入 Obsidian 环境与本地仓储 */
    constructor(private app: App, private repository: PluginDataRepository, private root: HTMLElement, page = "概览") { this.page = page; }
    /** 清理图表和尺寸监听 */
    destroy(): void { this.charts.forEach((chart) => chart.dispose()); this.charts = []; this.observer?.disconnect(); }
    /** 创建带图标的可操作按钮 */
    private button(parent: HTMLElement, label: string, action: () => void, icon?: string, cls = ""): HTMLButtonElement {
        // 原型中的操作按钮
        // 响应用户操作的按钮
        const button = parent.createEl("button", { cls, text: label });
        if (icon) {
            // 业务指标图标
            const glyph = button.createSpan({ cls: "pv-icon" });
            setIcon(glyph, icon);
            button.prepend(glyph);
        }
        button.onclick = action;
        return button;
    }
    /** 创建一致的卡片容器 */
    private panel(parent: HTMLElement, title?: string): HTMLElement {
        // 各页面通用的信息卡片
        // 统一的信息卡片
        const panel = parent.createDiv({ cls: "pv-panel" });
        if (title)
            panel.createEl("h2", { text: title });
        return panel;
    }
    /** 展示具有强调色和业务单位的统计卡 */
    private metric(parent: HTMLElement, title: string, value: string, icon: string, tone: string, note = ""): void {
        // 单个统计卡与圆形图标
        // 统计卡片容器
        const card = parent.createDiv({ cls: `pv-metric pv-${tone}` });
        // 统计卡的语义图标
        // 业务指标图标
        const glyph = card.createDiv({ cls: "pv-metric-icon" });
        setIcon(glyph, icon);
        // 数值及说明
        // 指标标题与数值
        const copy = card.createDiv();
        copy.createDiv({ text: title });
        copy.createEl("strong", { text: value });
        if (note)
            copy.createEl("small", { text: note });
    }
    /** 切换页面并定位指定日期，待处理入口同时清除旧搜索条件 */
    private navigate(page: string, date?: string, showPending = false): void {
        this.page = page;
        if (date) {
            this.selected = date;
            this.month = date.slice(0, 7);
        }
        if (showPending) {
            this.filter = "待处理";
            this.search = "";
        }
        this.render();
    }
    /** 渲染统一导航及当前页面，原地更新数据时保留滚动位置 */
    render(preserveScroll = false): void {
        // 同时兼容看板自身及 Obsidian 外层容器承载滚动的布局
        const scrollPositions: { element: HTMLElement; top: number; left: number }[] = [];
        if (preserveScroll) {
            // 从看板向外记录各层容器，避免清空内容时丢失滚动位置
            let element: HTMLElement | null = this.root;
            while (element) {
                scrollPositions.push({ element, top: element.scrollTop, left: element.scrollLeft });
                element = element.parentElement;
            }
        }
        this.destroy();
        this.root.empty();
        this.root.addClass("otv-view", "pv-app");
        // 顶部应用导航
        // 统一页面导航栏
        const nav = this.root.createDiv({ cls: "pv-nav" });
        // 品牌图标与名称
        // 应用品牌展示
        const brand = nav.createDiv({ cls: "pv-brand", text: "下班压力" });
        // 品牌图标
        const icon = brand.createSpan();
        setIcon(icon, "sunset");
        brand.prepend(icon);
        ["概览", "每日记录", "年度回顾"].forEach((page) => this.button(nav, page, () => this.navigate(page), undefined, this.page === page ? "is-active" : ""));
        nav.createSpan({ cls: "pv-local", text: "● 仅保存在本地" });
        this.button(nav, "导入考勤", () => new ImportPreviewModal(this.app, this.repository, () => this.render()).open(), "upload", "pv-primary");
        this.button(nav, "导出全部", () => { void exportJson(this.app, "考勤与解压备份", createCombinedBackup(this.repository)); }, "download");
        this.button(nav, "导出考勤", () => { void exportJson(this.app, "考勤明细", { body: { list: this.repository.list().map((record) => record.source) } }); }, "download");
        this.button(nav, "导出解压", () => { void exportJson(this.app, "解压明细", { entries: this.repository.listReliefEntries() }); }, "download");
        // 当前页的内容容器
        // 当前导航页面内容
        const body = this.root.createDiv({ cls: "pv-body" });
        if (this.page === "每日记录")
            this.daily(body);
        else
            this.overview(body, this.page === "年度回顾");
        // 内容重建完成后同步恢复位置，避免用户连续记录解压事项时页面跳动
        scrollPositions.forEach(({ element, top, left }) => {
            element.scrollTop = top;
            element.scrollLeft = left;
        });
    }
    /** 用真实日级账本绘制三条压力折线 */
    private trend(parent: HTMLElement, labels: string[], values: (number | null)[][], departure = false): void {
        // 压力趋势图容器
        // 压力趋势图挂载节点
        const host = parent.createDiv({ cls: "pv-chart" });
        // 当前图表实例
        // 当前压力趋势图实例
        const chart = init(host, undefined, { renderer: "svg" });
        chart.setOption({ color: departure ? ["#8bbcff"] : ["#ff9d61", "#66eaa5", "#f66aab"], grid: { left: 45, right: 22, top: 48, bottom: 35 }, legend: { top: 4, right: 8, textStyle: { color: "#b9c5d6" } }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: labels, axisLabel: { color: "#b9c5d6", hideOverlap: true }, axisLine: { lineStyle: { color: "#586575" } } }, yAxis: { type: "value", min: departure ? 18 : 0, axisLabel: { color: "#b9c5d6", formatter: departure ? (value: number) => formatClockMinute(Math.round(value * 60)) : undefined }, splitLine: { lineStyle: { color: "#34414e", type: "dashed" } } }, series: (departure ? ["下班时间"] : ["加班压力", "实际抵扣", "最终压力"]).map((name, index) => ({ name, type: "line", smooth: departure ? 0.15 : 0.4, smoothMonotone: "x", data: values[index], symbolSize: 6, areaStyle: index === 2 ? { opacity: 0.08 } : undefined })) });
        this.charts.push(chart);
        this.observer ??= new ResizeObserver(() => this.charts.forEach((item) => item.resize()));
        this.observer.observe(host);
    }
    /** 创建按比例表达天数或小时数的横向统计条 */
    private bar(parent: HTMLElement, label: string, value: number, maximum: number, suffix: string, tone = "green", labelDetail?: string): void {
        // 单项分布条
        // 当前数据展示行
        const row = parent.createDiv({ cls: `pv-bar pv-${tone}` });
        // 时段与单日分值同行展示，右侧继续显示统计天数
        const caption = row.createSpan({ text: label });
        if (labelDetail) {
            row.addClass("otv-pressure-band");
            caption.createEl("small", { text: labelDetail });
        }
        // 填充比例以真实统计计算
        // 统计条的比例轨道
        const track = row.createDiv({ cls: "pv-track" });
        track.createDiv({ cls: "pv-fill" }).style.width = `${maximum ? value / maximum * 100 : 0}%`;
        row.createSpan({ text: `${Math.round(value * 10) / 10} ${suffix}` });
    }
    /** 展示概览或指定年份的独立年度回顾 */
    private overview(body: HTMLElement, annual: boolean): void {
        // 本地日期与配置
        // 用于账本结算的本地日期
        const today = formatLocalIsoDate(new Date());
        // 个人解压事项配置
        const settings = this.repository.getSettings().reliefActivities;
        // 当前所选周期的数据
        // 当前周期的真实考勤记录
        const records = this.repository.list().filter((record) => annual ? record.date.startsWith(String(this.year)) : record.date >= this.start && record.date <= this.end);
        // 本地解压活动记录
        const entries = this.repository.listReliefEntries().filter((entry) => annual ? entry.date.startsWith(String(this.year)) : entry.date >= this.start && entry.date <= this.end);
        // 当日封顶抵扣后的压力结算
        const ledger = summarizePressureLedger(records, entries, today, settings);
        // 有效出勤及晚归分布统计
        const metrics = calculateWorkloadMetrics(records);
        // 页标题与日期控制
        // 当前页面标题和操作区域
        const heading = body.createDiv({ cls: "pv-heading" });
        // 指标标题与数值
        const copy = heading.createDiv();
        copy.createEl("h1", { text: annual ? `${this.year} 年度回顾` : "最近的工作节奏" });
        copy.createEl("p", { text: annual ? `${this.year}-01-01 至 ${this.year === Number(today.slice(0, 4)) ? today : `${this.year}-12-31`} · ${metrics.validAttendanceDays} 个有效出勤日` : "看看晚归变化，也给自己留一点恢复时间" });
        // 日期筛选操作区域
        const controls = heading.createDiv({ cls: "pv-controls" });
        if (annual) {
            // 只提供已有记录及当前年份
            // 已有年份的选择控件
            const select = controls.createEl("select");
            [...new Set([Number(today.slice(0, 4)), ...this.repository.list().map((record) => Number(record.date.slice(0, 4)))])].sort((a, b) => b - a).forEach((year) => select.createEl("option", { value: String(year), text: `${year} 年` }));
            select.value = String(this.year);
            select.onchange = () => { this.year = Number(select.value); this.render(); };
            this.button(controls, "分享年度总结", () => this.share(), "share-2", "pv-primary");
        }
        else {
            this.button(controls, "近30天", () => { this.start = shiftIsoDate(today, -29); this.end = today; this.render(); });
            this.button(controls, "本月", () => { this.start = `${today.slice(0, 7)}-01`; this.end = today; this.render(); });
            ["start", "end"].forEach((field) => {
                renderDatePicker(controls, field === "start" ? "起始日期" : "结束日期", field === "start" ? this.start : this.end, (value) => {
                    if (field === "start") this.start = value;
                    else this.end = value;
                    if (this.start > this.end) [this.start, this.end] = [this.end, this.start];
                    this.render();
                });
            });
        }
        // 原型首屏统计卡
        // 业务摘要指标卡区域
        const cards = body.createDiv({ cls: `pv-metrics ${annual ? "pv-three" : ""}` });
        if (annual)
            this.metric(cards, "加班压力", `${ledger.overtimeScore} 分`, "clock", "orange", `来自 ${metrics.validAttendanceDays} 个有效出勤日`);
        if (!annual)
            this.metric(cards, "最终压力", `${ledger.finalScore} 分`, "zap", "pink", annual ? `加班压力 ${ledger.overtimeScore} − 实际抵扣 ${ledger.appliedReliefScore}` : "按日结算 · 当日抵扣封顶");
        if (!annual) {
            this.metric(cards, "平均下班", metrics.averageDepartureMinute === null ? "—" : formatClockMinute(metrics.averageDepartureMinute), "clock", "blue", "周一至周四有效出勤");
            this.metric(cards, "21点后下班", `${records.filter((record) => record.endMinute !== null && record.endMinute >= 1260).length} 天`, "moon", "orange");
        }
        this.metric(cards, "实际解压抵扣", `${ledger.appliedReliefScore} 分`, "leaf", "green");
        if (annual)
            this.metric(cards, "最终压力", `${ledger.finalScore} 分`, "heart", "pink", `加班压力 ${ledger.overtimeScore} − 实际抵扣 ${ledger.appliedReliefScore}`);
        // 主图和侧边信息
        // 图表和侧栏的分栏区域
        const grid = body.createDiv({ cls: "pv-overview-grid" });
        // 主要趋势图区域
        const main = grid.createDiv();
        // 解压和待处理侧栏
        const side = grid.createDiv({ cls: "pv-side" });
        // 当前压力趋势图实例
        const chart = this.panel(main, annual ? "每月压力变化" : "压力趋势");
        // 年度保留月份汇总，概览只连接有打卡信息的日期
        const dates = annual ? Array.from({ length: this.year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12 }, (_, i) => `${this.year}-${String(i + 1).padStart(2, "0")}`) : getAttendanceDates(records);
        // 逐日期结算后的指标
        const totals = dates.map((date) => summarizePressureLedger(records.filter((record) => annual ? record.date.startsWith(date) : record.date === date), entries.filter((entry) => annual ? entry.date.startsWith(date) : entry.date === date), today, settings));
        if (dates.length)
            this.trend(chart, dates.map((date) => annual ? `${Number(date.slice(5))}月` : date.slice(5)), [totals.map((item) => item.overtimeScore), totals.map((item) => item.appliedReliefScore), totals.map((item) => item.finalScore)]);
        else
            chart.createEl("p", { text: "当前区间暂无考勤记录。" });
        if (annual) {
            // 年度分享卡容器
            const share = this.panel(side, "年度总结分享");
            this.shareCard(share);
            this.button(share, "预览分享卡片", () => this.share(), "eye", "pv-primary pv-wide");
            // 年度分布与习惯区域
            const bottom = body.createDiv({ cls: "pv-bottom" });
            // 年度晚归分布面板
            const bands = this.panel(bottom, "晚归分布");
            metrics.departureBands.forEach((band) => this.bar(bands, band.label, band.count, Math.max(1, ...metrics.departureBands.map((item) => item.count)), "天", "pink"));
            // 年度解压习惯面板
            const habits = this.panel(bottom, "这一年的解压习惯");
            createReliefActivityDefinitions(settings).forEach((definition) => this.bar(habits, definition.label, entries.filter((entry) => entry.type === definition.type).reduce((sum, entry) => sum + entry.durationMinutes, 0) / 60, Math.max(1, ...createReliefActivityDefinitions(settings).map((item) => entries.filter((entry) => entry.type === item.type).reduce((sum, entry) => sum + entry.durationMinutes, 0) / 60)), "小时"));
        }
        else {
            // 常驻日历统一展示今日解压和历史明细
            const calendar = this.panel(side, "解压日历");
            calendar.addClass("otv-relief-calendar");
            this.reliefCalendar(calendar.createDiv({ cls: "otv-relief-calendar__layout" }), today);
            this.button(side, "查看今日记录 →", () => this.navigate("每日记录", today));
            // 含缺失打卡或跨夜警告的考勤
            const unresolved = this.repository.list().filter((record) => this.pending(record.date));
            if (unresolved.length > 0) {
                // 有需要人工核对的记录时才展示处理卡片
                const pending = this.panel(side, "需要处理");
                pending.createEl("p", { text: `${unresolved.length} 条待确认` });
                unresolved.sort((left, right) => right.date.localeCompare(left.date)).slice(0, 3).forEach((record) => this.button(pending, `${record.date} ${record.warnings[0] ?? "缺少打卡时间"} ›`, () => this.navigate("每日记录", record.date, true), "circle-alert", "pv-pending"));
            }
            // 概览可切换图表区域
            const lower = this.panel(main);
            // 图表类型选择区域
            const tabs = lower.createDiv({ cls: "pv-tabs" });
            ["下班时间", "日历热力", "压力构成"].forEach((tab) => this.button(tabs, tab, () => { this.chartTab = tab; this.render(); }, undefined, this.chartTab === tab ? "is-active" : ""));
            if (this.chartTab === "日历热力")
                this.calendar(lower);
            else if (this.chartTab === "压力构成") {
                metrics.departureBands.forEach((band) => this.bar(lower, band.label, band.count, Math.max(1, metrics.validAttendanceDays), "天", "pink", `${band.score} 分/天`));
                lower.createEl("small", { text: "时段分值适用于周一至周五。周六、周日有下班记录时按 6 分/天计。" });
            }
            else
                this.trend(lower, records.map((record) => record.date.slice(5)), [records.map((record) => record.endMinute === null ? null : record.endMinute / 60)], true);
        }
        if (!annual) {
            this.departureTrend(body);
            this.pressureTrend(body);
        }
        body.createEl("small", { cls: "pv-footnote", text: "个人记录指标 · 解压仅抵扣当日压力 · 数据仅保存在本地" });
    }
    /** 分别展示全量自然月与自然周趋势，缺失周期用独立虚线连接 */
    private departureTrend(parent: HTMLElement): void {
        ["month", "week"].forEach((unit) => {
            // 月均与周均独立成图，不受概览区间筛选影响
            const monthly = unit === "month";
            // 当前图表对应的自然周期统计
            const periods = calculateDepartureTrend(this.repository.list(), monthly ? "month" : "week");
            // 独立图表标题与统计说明
            const panel = this.panel(parent, monthly ? "月平均下班时间" : "周平均下班时间");
            panel.createEl("p", { text: `全部考勤数据 · 周一至周四有效出勤 · ${monthly ? "按自然月统计" : "自然周为周一至周日"} · 虚线仅连接无数据区间` });
            if (!periods.some((period) => period.count > 0)) {
                panel.createEl("p", { text: "暂无周一至周四有效出勤数据" });
                return;
            }
            // 当前图表的主题颜色
            const color = monthly ? "#8bbcff" : "#66eaa5";
            // 挂载节点由看板现有生命周期统一管理
            const host = panel.createDiv({ cls: "pv-chart" });
            // 每个缺口单独成线，避免跨越有效数据区间
            const bridges = getDepartureBridges(periods);
            // 当前独立图表实例
            const chart = init(host, undefined, { renderer: "svg" });
            chart.setOption({
                color: [color],
                grid: { left: 76, right: 24, top: 24, bottom: 42 },
                tooltip: { trigger: "item", formatter: (item: { seriesName: string; data: { periodLabel: string; count: number; value: [number, number | null] } }) => item.seriesName === "无数据区间" ? "此区间无有效出勤数据，虚线仅用于连接趋势" : `${item.data.periodLabel}<br/>平均下班：${item.data.value[1] === null ? "暂无数据" : formatClockMinute(item.data.value[1])}<br/>有效出勤：${item.data.count} 天` },
                xAxis: { type: "time", axisLabel: { color: "#b9c5d6", hideOverlap: true, formatter: (value: number) => new Date(value).toISOString().slice(0, monthly ? 7 : 10) }, axisLine: { lineStyle: { color: "#586575" } } },
                yAxis: { type: "value", scale: true, minInterval: 1, axisLabel: { color: "#b9c5d6", formatter: (value: number) => formatClockMinute(Math.round(value)) }, splitLine: { lineStyle: { color: "#34414e", type: "dashed" } } },
                series: [
                    { name: monthly ? "自然月平均" : "自然周平均", type: "line", connectNulls: false, smooth: 0.35, smoothMonotone: "x", showSymbol: true, symbolSize: 7, lineStyle: { color, width: 3 }, itemStyle: { color }, z: 3, data: periods.map((period) => ({ value: [Date.parse(`${period.start}T00:00:00Z`), period.minute], periodLabel: `${period.start} 至 ${period.end}`, count: period.count })) },
                    ...bridges.map((bridge) => ({ name: "无数据区间", type: "line", showSymbol: false, smooth: 0.35, smoothMonotone: "x", lineStyle: { color, width: 2, type: "dashed", opacity: 0.7 }, data: bridge.map((period) => [Date.parse(`${period.start}T00:00:00Z`), period.minute]) })),
                ],
            });
            this.charts.push(chart);
            this.observer ??= new ResizeObserver(() => this.charts.forEach((item) => item.resize()));
            this.observer.observe(host);
        });
    }
    /** 展示全量月均与周均压力，勾选后叠加逐日解压抵扣的最终压力 */
    private pressureTrend(parent: HTMLElement): void {
        (["month", "week"] as const).forEach((unit) => {
            // 自然月与自然周沿用下班时间面板的布局和日期轴
            const monthly = unit === "month";
            // 平均值只使用已结算的考勤日期，原始与最终压力保持相同分母
            const periods = calculatePressureTrend(this.repository.list(), this.repository.listReliefEntries(), formatLocalIsoDate(new Date()), unit, this.repository.getSettings().reliefActivities);
            // 独立压力趋势卡片
            const panel = this.panel(parent, monthly ? "月平均压力指数" : "周平均压力指数");
            panel.createEl("p", { text: `全部考勤数据 · 已结算考勤日均（含周末及零压力日） · ${monthly ? "按自然月统计" : "自然周为周一至周日"} · 虚线仅连接无数据区间` });
            // 使用原生复选框提供可键盘操作的最终压力开关
            const label = panel.createEl("label", { cls: "pv-controls otv-pressure-toggle" });
            // 两个面板分别保留本次看板会话内的勾选状态
            const toggle = label.createEl("input", { type: "checkbox" });
            toggle.checked = this.showFinalPressure[unit];
            label.createSpan({ text: "显示解压抵扣后的最终压力" });
            toggle.onchange = () => { this.showFinalPressure[unit] = toggle.checked; this.render(true); };
            if (!periods.some((period) => period.count > 0)) {
                panel.createEl("p", { text: "暂无已结算考勤数据（当天及缺失下班时间的记录不计入）" });
                return;
            }
            // 图表节点由看板统一处理缩放和销毁
            const host = panel.createDiv({ cls: "pv-chart" });
            // 每条曲线以相同周期和样本数绘制
            const series = (["overtime", ...(this.showFinalPressure[unit] ? ["final" as const] : [])] as const).flatMap((key) => {
                // 原始压力与最终压力使用稳定的图例名称
                const name = key === "overtime" ? "原始加班压力" : "最终压力";
                // 保持原始压力橙色、最终压力粉色的既有语义
                const color = key === "overtime" ? "#ff9d61" : "#f66aab";
                // 仅在两个真实周期之间连接缺口，不填补数值
                const bridges: [number, number][][] = [];
                // 最近的有效周期索引用来识别中间缺口
                let previous = -1;
                periods.forEach((period, index) => {
                    if (period[key] === null) return;
                    if (previous >= 0 && index > previous + 1) bridges.push([previous, index].map((position) => [Date.parse(`${periods[position]!.start}T00:00:00Z`), periods[position]![key]!]));
                    previous = index;
                });
                return [
                    { name, type: "line", connectNulls: false, smooth: 0.35, smoothMonotone: "x", symbolSize: 7, lineStyle: { color, width: 3 }, itemStyle: { color }, data: periods.map((period) => ({ value: [Date.parse(`${period.start}T00:00:00Z`), period[key]], periodLabel: `${period.start} 至 ${period.end}`, count: period.count })) },
                    ...bridges.map((data) => ({ name, type: "line", showSymbol: false, silent: true, tooltip: { show: false }, lineStyle: { color, width: 2, type: "dashed", opacity: 0.7 }, data })),
                ];
            });
            // 当前压力图实例复用现有 SVG 渲染和生命周期
            const chart = init(host, undefined, { renderer: "svg" });
            chart.setOption({
                legend: { top: 4, right: 8, textStyle: { color: "#b9c5d6" } },
                grid: { left: 76, right: 24, top: 48, bottom: 42 },
                tooltip: { trigger: "item", formatter: (item: { seriesName: string; data: { periodLabel: string; count: number; value: [number, number | null] } }) => `${item.data.periodLabel}<br/>${item.seriesName}：${item.data.value[1]?.toFixed(2) ?? "暂无数据"} 分/天<br/>已结算考勤：${item.data.count} 天` },
                xAxis: { type: "time", axisLabel: { color: "#b9c5d6", hideOverlap: true, formatter: (value: number) => new Date(value).toISOString().slice(0, monthly ? 7 : 10) }, axisLine: { lineStyle: { color: "#586575" } } },
                yAxis: { type: "value", min: 0, name: "分/天", nameTextStyle: { color: "#b9c5d6" }, axisLabel: { color: "#b9c5d6" }, splitLine: { lineStyle: { color: "#34414e", type: "dashed" } } },
                series,
            });
            this.charts.push(chart);
            this.observer ??= new ResizeObserver(() => this.charts.forEach((item) => item.resize()));
            this.observer.observe(host);
        });
    }
    /** 判断记录是否需要人工处理 */
    private pending(date: string): boolean {
    // 当前日期的考勤事实
    const record = this.repository.get(date); return !!record && (record.warnings.length > 0 || ["incomplete", "missing-punch", "ambiguous-start"].includes(record.attendanceState) || record.overnightState === "ambiguous"); }
    /** 展示真实月份日历并支持点击进入单日 */
    private calendar(parent: HTMLElement): void {
        // 根据概览区间得到月份集合
        // 统计区间中的月份
        const months = [...new Set([this.start.slice(0, 7), this.end.slice(0, 7)])];
        // 月历并排展示区域
        const group = parent.createDiv({ cls: "pv-calendars" });
        months.forEach((month) => {
            // 单月日历容器
            const calendar = group.createDiv({ cls: "pv-calendar" });
            calendar.createEl("h3", { text: `${month.slice(0, 4)}年${Number(month.slice(5))}月` });
            renderMonthDays(calendar, month, (cells, date, day) => {
                // 当前日期的考勤事实
                const record = this.repository.get(date);
                // 当日封顶抵扣后的压力结算
                const ledger = calculateDailyPressureLedger(date, record ?? undefined, this.repository.listReliefEntries().filter((entry) => entry.date === date), formatLocalIsoDate(new Date()), this.repository.getSettings().reliefActivities);
                // 可点击查看详情的日期按钮
                const cell = this.button(cells, String(day), () => this.navigate("每日记录", date));
                if (record?.endMinute !== null && record?.endMinute !== undefined)
                    cell.style.backgroundColor = `rgba(246,106,171,${0.08 + Math.min(ledger.overtimeScore / 12, 1) * 0.85})`;
                cell.title = `${date} · ${record?.endMinute == null ? "无有效下班时间" : formatClockMinute(record.endMinute)}`;
            });
        });
        parent.createDiv({ cls: "pv-calendar-legend", text: "无数据  ░ ▒ ▓ 压力由低到高 · 点击日期查看记录" });
    }
    /** 在概览中按自然日浏览和修改解压记录 */
    private reliefCalendar(host: HTMLElement, today: string): void {
        host.empty();
        // 日历与明细共用的日期，不依赖仓储中是否有该日考勤
        const date = this.reliefDate ?? today;
        // 选中日期所在的月份
        const month = date.slice(0, 7);
        // 用于标记有记录的日期并提取当前日明细的完整数据
        const entries = this.repository.listReliefEntries();
        // 有解压明细的日期显示圆点
        const recordedDates = new Set(entries.map((entry) => entry.date));
        // 月份切换后只刷新日历，并恢复键盘焦点
        const select = (target: string, focus: string) => {
            this.reliefDate = target === today ? null : target;
            this.reliefCalendar(host, today);
            host.querySelector<HTMLElement>(focus)?.focus();
        };
        // 月历与当日明细分栏展示，便于选中日期后直接查看
        const monthPanel = host.createDiv({ cls: "otv-relief-calendar__month" });
        // 月份浏览与返回当天的操作栏
        const controls = monthPanel.createDiv({ cls: "otv-relief-calendar__controls" });
        // 翻月箭头与标题作为一组，窄栏换行时保持相邻
        const navigation = controls.createDiv({ cls: "otv-relief-calendar__navigation" });
        this.button(navigation, "‹", () => select(shiftIsoDate(`${month}-01`, -1), ".otv-relief-calendar__previous"), undefined, "otv-relief-calendar__previous")
            .setAttribute("aria-label", "上个月");
        navigation.createEl("strong", { text: `${month.slice(0, 4)}年${Number(month.slice(5))}月` });
        this.button(navigation, "›", () => select(`${shiftIsoDate(`${month}-01`, 32).slice(0, 7)}-01`, ".otv-relief-calendar__next"), undefined, "otv-relief-calendar__next")
            .setAttribute("aria-label", "下个月");
        this.button(controls, "回到今天", () => select(today, '[aria-pressed="true"]'), undefined, "otv-relief-calendar__today");
        renderMonthDays(monthPanel, month, (cells, dayDate, day) => {
            // 每个自然日均可进入解压编辑，包括完全无考勤数据的日期
            const cell = this.button(cells, String(day), () => select(dayDate, '[aria-pressed="true"]'), undefined, dayDate === date ? "is-active" : "");
            cell.classList.toggle("is-future", dayDate > today);
            // 记录状态同时提供给视觉标记与辅助技术
            const hasEntries = recordedDates.has(dayDate);
            cell.classList.toggle("has-relief", hasEntries);
            cell.setAttribute("aria-label", `${dayDate} ${formatWeekday(dayDate)}${hasEntries ? "，有解压记录" : ""}`);
            cell.setAttribute("aria-pressed", String(dayDate === date));
            if (dayDate === today)
                cell.setAttribute("aria-current", "date");
        });
        monthPanel.createEl("small", { cls: "otv-relief-calendar__legend", text: "有解压记录" });

        // 当前日期的解压明细与业务配置
        const dayEntries = entries.filter((entry) => entry.date === date);
        // 个人设置计算解压分并决定可补录的事项
        const settings = this.repository.getSettings().reliefActivities;
        // 考勤尚未同步时仍提供同一套解压编辑操作
        const record = this.repository.get(date);
        // 所选日期与当日累计分数
        const detail = host.createDiv({ cls: "otv-relief-calendar__detail" });
        // 日期标题旁直接提示考勤是否已有打卡时间
        const detailHeading = detail.createDiv({ cls: "otv-relief-calendar__detail-heading" });
        detailHeading.createEl("h3", { text: `${date} · ${formatWeekday(date)}` });
        if (record?.startMinute == null && record?.endMinute == null)
            detailHeading.createSpan({ cls: "otv-relief-calendar__attendance", text: "暂无打卡" });
        // 累计分数使用与今日解压卡片一致的绿色
        const total = detail.createEl("p", { cls: "otv-relief-calendar__score", text: "累计解压 " });
        total.createEl("strong", { text: `${calculateReliefScore(dayEntries, settings)} 分` });
        if (!dayEntries.length)
            detail.createEl("p", { text: "当天暂无解压记录" });
        this.reliefRecords(detail, date, dayEntries, settings);
    }
    /** 为指定日期提供补录、修改及删除解压明细的操作 */
    private reliefRecords(parent: HTMLElement, date: string, entries: ReliefEntry[], settings: ReliefActivitySetting[]): void {
        // 事项快捷入口随可用宽度和事项数量换行
        const shortcuts = parent.createDiv({ cls: "pv-relief-shortcuts" });
        // 历史明细可以继续显示已停用的个人事项名称
        const historyDefinitions = createReliefActivityDefinitions(settings, true);
        createReliefActivityDefinitions(settings).forEach((definition) => this.button(shortcuts, `+ ${definition.label}`, () => {
            void this.repository.addReliefEntry(date, definition.type, definition.incrementMinutes)
                .then(() => this.render(true), () => new Notice("添加解压记录失败"));
        }, undefined, "pv-relief-add"));
        entries.forEach((entry) => {
            // 一条解压明细的名称、时长和编辑操作
            const row = parent.createDiv({ cls: "pv-relief-row" });
            row.createSpan({ text: `${historyDefinitions.find((item) => item.type === entry.type)?.label ?? entry.type} · ${entry.durationMinutes} 分钟` });
            row.createEl("strong", { cls: "pv-pink", text: `${calculateReliefScore([entry], settings)} 分` });
            this.button(row, "", () => new ReliefEditModal(this.app, this.repository, entry, () => this.render(true)).open(), "pencil")
                .setAttribute("aria-label", "编辑解压记录");
            this.button(row, "", () => {
                void this.repository.deleteReliefEntry(entry.id).then(() => this.render(true), () => new Notice("删除解压记录失败"));
            }, "trash-2").setAttribute("aria-label", "删除解压记录");
        });
    }
    /** 展示按月筛选的记录表格及右侧单日详情 */
    private daily(body: HTMLElement): void {
        // 两栏记录工作区
        // 每日记录表格及详情的两栏布局
        const layout = body.createDiv({ cls: "pv-daily-grid" });
        // 筛选与每日记录列表
        const list = this.panel(layout);
        // 所选日期的业务详情
        const detail = this.panel(layout);
        list.createEl("h1", { text: "每日记录" });
        list.createEl("p", { text: "考勤与解压，按天一起查看" });
        // 月份状态和搜索操作区
        const tools = list.createDiv({ cls: "pv-controls pv-daily-tools" });
        // 月份选择与快捷翻月保持在一组，窄栏换行时一起移动
        const monthFilter = tools.createDiv({ cls: "pv-month-filter" });
        this.button(monthFilter, "‹", () => { this.month = shiftIsoDate(`${this.month}-01`, -1).slice(0, 7); this.render(); }).setAttribute("aria-label", "上个月");
        renderMonthPicker(monthFilter, this.month, (value) => {
            this.month = value;
            this.render(true);
            this.root.querySelector<HTMLButtonElement>(".pv-month-filter .pv-date-trigger")?.focus();
        });
        this.button(monthFilter, "›", () => { this.month = shiftIsoDate(`${this.month}-01`, 32).slice(0, 7); this.render(); }).setAttribute("aria-label", "下个月");
        ["全部", "待处理", "人工修正"].forEach((filter) => this.button(tools, filter, () => { this.filter = filter; this.render(); }, undefined, this.filter === filter ? "is-active" : ""));
        // 日期和解压事项搜索输入
        const search = tools.createEl("input", { type: "search", placeholder: "搜索日期、内容…" });
        search.value = this.search;
        search.onchange = () => { this.search = search.value; this.render(); };
        this.button(tools, "新增记录", () => new DailyAttendanceModal(this.app, this.repository, this.selected || formatLocalIsoDate(new Date()), () => this.render()).open(), "plus", "pv-primary");
        // 本地解压活动记录
        const entries = this.repository.listReliefEntries();
        // 个人解压事项配置
        const settings = this.repository.getSettings().reliefActivities;
        // 用于账本结算的本地日期
        const today = formatLocalIsoDate(new Date());
        // 已停用事项的历史名称继续使用保存配置
        const historyDefinitions = createReliefActivityDefinitions(settings, true);
        // 读取每日列表候选考勤
        const records = this.repository.list();
        // 待处理包含没有打卡的异常考勤，其他筛选继续使用实际打卡日期
        const candidateDates = this.filter === "待处理"
            ? records.filter((record) => this.pending(record.date)).map((record) => record.date).sort()
            : getAttendanceDates(records);
        // 列表与详情共用月份、状态及搜索结果
        const dates = candidateDates.filter((date) => {
            // 当前日期的历史解压名称参与搜索
            const reliefNames = [...new Set(entries.filter((entry) => entry.date === date).map((entry) => historyDefinitions.find((item) => item.type === entry.type)?.label ?? entry.type))].join(" · ");
            return date.startsWith(this.month)
                && (this.filter !== "人工修正" || this.repository.get(date)?.manuallyEdited)
                && (!this.search || `${date} ${reliefNames} ${this.repository.get(date)?.leaveReasons.join(" ")}`.includes(this.search));
        }).reverse();
        if (!dates.includes(this.selected))
            this.selected = dates[0] ?? "";
        // 仅表格横向滚动，月份浮层可以越过卡片边界完整展示
        const tableScroll = list.createDiv({ cls: "pv-daily-table-scroll" });
        // 按日期组织的考勤解压表格
        const table = tableScroll.createEl("table", { cls: "pv-table" });
        // 记录表格的列标题
        const header = table.createEl("thead").createEl("tr");
        ["日期", "考勤", "解压", "最终压力", "状态"].forEach((label) => header.createEl("th", { text: label }));
        // 当前筛选条件下的记录行
        const rows = table.createEl("tbody");
        dates.forEach((date) => {
            // 当前日期的考勤事实
            const record = this.repository.get(date);
            // 所选日期的解压记录
            const dayEntries = entries.filter((entry) => entry.date === date);
            // 当天解压事项的展示名称
            const reliefNames = [...new Set(dayEntries.map((entry) => historyDefinitions.find((item) => item.type === entry.type)?.label ?? entry.type))].join(" · ");
            // 当日封顶抵扣后的压力结算
            const ledger = calculateDailyPressureLedger(date, record ?? undefined, dayEntries, today, settings);
            // 当前数据展示行
            const row = rows.createEl("tr", { cls: date === this.selected ? "is-selected" : "" });
            row.onclick = () => { this.selected = date; this.render(); };
            row.tabIndex = 0;
            row.onkeydown = (event) => { if (event.key === "Enter") {
                this.selected = date;
                this.render();
            } };
            // 日期下方的星期保持与单日详情一致
            const day = row.createEl("td", { text: `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` });
            day.createEl("small", { cls: "otv-daily-weekday", text: formatWeekday(date) });
            // 单日上班下班摘要单元
            const attendance = row.createEl("td");
            attendance.createEl("strong", { text: `${record?.startMinute == null ? "—" : formatClockMinute(record.startMinute)} – ${record?.endMinute == null ? "—" : formatClockMinute(record.endMinute)}` });
            attendance.createEl("small", { text: record?.dayType === "workday" ? "工作日" : record?.dayType === "holiday" ? "节假日" : "休息日 / 无考勤" });
            // 单日解压记录展示区
            const relief = row.createEl("td");
            relief.createSpan({ text: reliefNames || "无解压记录" });
            relief.createEl("small", { text: `${ledger.reliefScore} 分（抵扣 ${ledger.appliedReliefScore} 分）` });
            row.createEl("td", { cls: "pv-pink", text: ledger.status === "settled" ? `${ledger.finalScore} 分` : "—" });
            row.createEl("td").createSpan({ cls: `pv-badge ${record?.manuallyEdited ? "pv-purple" : this.pending(date) ? "pv-orange" : "pv-green"}`, text: record?.manuallyEdited ? "人工修正" : this.pending(date) ? "待处理" : ledger.status === "no-work" ? "无有效出勤" : ledger.status === "pending" ? "待结算" : "正常" });
        });
        if (!rows.children.length) {
            list.createEl("p", { text: "当前条件下没有考勤记录，请切换月份或新增记录。" });
            detail.createEl("p", { text: "暂无可展示的考勤详情。" });
            return;
        }
        // 当前日期的考勤事实
        const record = this.repository.get(this.selected);
        // 所选日期的解压记录
        const dayEntries = entries.filter((entry) => entry.date === this.selected);
        // 当日封顶抵扣后的压力结算
        const ledger = calculateDailyPressureLedger(this.selected, record ?? undefined, dayEntries, today, settings);
        // 当前页面标题和操作区域
        const heading = detail.createDiv({ cls: "pv-heading" });
        heading.createEl("h2", { text: `${this.selected} · ${formatWeekday(this.selected)}` });
        // 上一日与下一日操作区域
        const arrows = heading.createDiv();
        [-1, 1].forEach((offset) => {
            // 按日期先后跳转当前筛选范围内相邻的考勤记录
            const target = dates[dates.indexOf(this.selected) - offset];
            // 没有相邻记录时禁用切换，避免进入无考勤日期
            const button = this.button(arrows, offset === -1 ? "‹" : "›", () => {
                if (target) {
                    this.selected = target;
                    this.render();
                }
            });
            button.disabled = !target;
        });
        // 业务摘要指标卡区域
        const cards = detail.createDiv({ cls: "pv-metrics pv-three pv-detail-metrics" });
        this.metric(cards, "加班压力", `${ledger.overtimeScore} 分`, "clock", "orange");
        this.metric(cards, "实际抵扣", `${ledger.appliedReliefScore} 分`, "leaf", "green");
        this.metric(cards, "最终", ledger.status === "settled" ? `${ledger.finalScore} 分` : "—", "flame", "pink");
        // 考勤事实和修正入口
        const facts = this.panel(detail, "考勤");
        this.button(facts, "编辑", () => new DailyAttendanceModal(this.app, this.repository, this.selected, () => this.render()).open(), "pencil", "pv-edit");
        // 打卡工作日和上线日信息区域
        const factsGrid = facts.createDiv({ cls: "pv-facts" });
        [["上班", record?.startMinute == null ? "—" : formatClockMinute(record.startMinute)], ["下班", record?.endMinute == null ? "—" : formatClockMinute(record.endMinute)], ["工作日", record?.dayType === "workday" ? "是" : "否"], ["上线日", record?.isReleaseDay ? "是" : "否"]].forEach(([label, value]) => {
        // 当前统计或事实展示项
        const item = factsGrid.createDiv(); item.createEl("small", { text: label }); item.createEl("strong", { text: value }); });
        facts.createEl("p", { text: `来源：${record?.manuallyEdited ? "已人工修正" : record ? "考勤导入" : "暂无考勤"}` });
        if (record)
            this.button(facts, "查看导入原始值", () => {
            // 本地详情或分享预览弹窗
            const modal = new Modal(this.app); modal.setTitle("导入快照"); modal.contentEl.createEl("pre", { text: JSON.stringify(record.source, null, 2) }); modal.open(); }, "file-text");
        // 单日解压记录展示区
        const relief = this.panel(detail, "解压记录");
        this.reliefRecords(relief, this.selected, dayEntries, settings);
        relief.createEl("p", { text: `记录解压 ${ledger.reliefScore} 分，本日实际抵扣 ${ledger.appliedReliefScore} 分` });
        if (record && (record.warnings.length || record.attendanceState === "missing-punch" || record.attendanceState === "incomplete"))
            detail.createEl("p", { cls: "pv-orange", text: `待确认：${record.warnings.join("；") || "缺少打卡时间"}` });
    }
    /** 绘制可在弹窗预览的年度分享卡 */
    private shareCard(parent: HTMLElement): HTMLElement {
        // 当前年份的真实压力账本
        // 当前周期的真实考勤记录
        const records = this.repository.list().filter((record) => record.date.startsWith(String(this.year)));
        // 本地解压活动记录
        const entries = this.repository.listReliefEntries().filter((entry) => entry.date.startsWith(String(this.year)));
        // 当日封顶抵扣后的压力结算
        const ledger = summarizePressureLedger(records, entries, formatLocalIsoDate(new Date()), this.repository.getSettings().reliefActivities);
        // 分享卡按考勤工作日口径统计下班分布
        const departureSummary = calculateAnnualDepartureSummary(records);
        // 统计卡片容器
        const card = parent.createDiv({ cls: "pv-share-card" });
        card.createDiv({ cls: "pv-sunset" });
        card.createEl("h2", { text: `${this.year} 工作与恢复` });
        card.createEl("small", { text: `${calculateWorkloadMetrics(records).validAttendanceDays} 个有效出勤日` });
        card.createEl("p", { text: "工作很认真\n也在好好照顾自己" });
        // 有效出勤及晚归分布统计
        const metrics = card.createDiv({ cls: "pv-share-metrics" });
        [["加班压力", ledger.overtimeScore], ["实际解压抵扣", ledger.appliedReliefScore], ["最终压力", ledger.finalScore]].forEach(([label, score], index) => {
        // 当前统计或事实展示项
        const item = metrics.createDiv({ cls: ["pv-orange", "pv-green", "pv-pink"][index] }); item.createEl("strong", { text: `${score} 分` }); item.createEl("small", { text: String(label) }); });
        // 内嵌卡片与截图预览共用同一份工作日下班统计
        const departures = card.createDiv({ cls: "pv-share-departures" });
        departures.createEl("h3", { text: "这一年的下班时间" });
        departures.createEl("p", { text: `累计记录 ${departureSummary.totalWorkdays} 个工作日 · 已确认下班 ${departureSummary.departureWorkdays} 天` });
        departureSummary.bands.forEach((band) => {
            // 单个互斥下班档位及对应工作日天数
            const row = departures.createDiv({ cls: "pv-share-departure-row" });
            row.createSpan({ text: band.label });
            row.createEl("strong", { text: `${band.count} 天` });
        });
        departures.createEl("small", { text: `按考勤工作日标记统计，含调休上班日；全天请假 ${departureSummary.fullLeaveWorkdays} 天、待确认 ${departureSummary.pendingWorkdays} 天不计入分布。跨夜归属加班开始日。` });
        card.createEl("p", { cls: "pv-share-quote", text: "下班后，也是生活的一部分。" });
        return card;
    }
    /** 打开年度卡片预览并支持复制完整图片 */
    private share(): void {
        // 本地年度分享预览弹窗
        const modal = new Modal(this.app);
        modal.modalEl.addClass("pv-app", "pv-share-modal");
        modal.setTitle("年度总结分享");
        // 复制时只绘制这张卡片，不包含操作按钮
        const card = this.shareCard(modal.contentEl);
        // 生成期间禁用按钮，防止重复写入剪贴板
        const copyButton = this.button(modal.contentEl, "复制图片", () => {
            copyButton.disabled = true;
            copyButton.textContent = "正在复制…";
            void copyShareImage(card).then(() => {
                new Notice("年度总结图片已复制，可直接粘贴");
            }).catch(() => {
                new Notice("复制图片失败，请重试；若当前环境不支持，可使用系统截图");
            }).finally(() => {
                copyButton.disabled = false;
                copyButton.textContent = "复制图片";
            });
        }, undefined, "pv-primary pv-wide");
        modal.open();
    }
}

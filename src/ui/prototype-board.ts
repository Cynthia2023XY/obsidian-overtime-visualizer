import { App, Modal, setIcon } from "obsidian";
import { init, use, type ECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import { calculateDailyPressureLedger, calculateReliefScore, createReliefActivityDefinitions, summarizePressureLedger } from "../analytics/pressure-ledger";
import { calculateWorkloadMetrics } from "../analytics/workload-evaluation";
import { formatLocalIsoDate, shiftIsoDate } from "../utils/date";
import { formatClockMinute } from "../utils/time";
import { ImportPreviewModal } from "./import-preview-modal";
import { DailyAttendanceModal, ReliefEditModal } from "./data-management-modals";
import { renderReliefPanel } from "./relief-panel";
use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
/** 按原型组织三页导航、真实账本和本地编辑操作 */
export class PrototypeBoard {
    /** 当前导航页签 */
    private page: string;
    /** 当前每日详情日期 */
    private selected = "";
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
    /** 切换导航并同步当前页面 */
    private navigate(page: string, date?: string): void { this.page = page; if (date) {
        this.selected = date;
        this.month = date.slice(0, 7);
    } this.render(); }
    /** 渲染统一导航及当前页面 */
    render(): void {
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
        // 当前页的内容容器
        // 当前导航页面内容
        const body = this.root.createDiv({ cls: "pv-body" });
        if (this.page === "每日记录")
            this.daily(body);
        else
            this.overview(body, this.page === "年度回顾");
    }
    /** 用真实日级账本绘制三条压力折线 */
    private trend(parent: HTMLElement, labels: string[], values: (number | null)[][], departure = false): void {
        // 压力趋势图容器
        // 压力趋势图挂载节点
        const host = parent.createDiv({ cls: "pv-chart" });
        // 当前图表实例
        // 当前压力趋势图实例
        const chart = init(host, undefined, { renderer: "svg" });
        chart.setOption({ color: departure ? ["#8bbcff"] : ["#ff9d61", "#66eaa5", "#f66aab"], grid: { left: 45, right: 22, top: 48, bottom: 35 }, legend: { top: 4, right: 8, textStyle: { color: "#b9c5d6" } }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: labels, axisLabel: { color: "#b9c5d6", hideOverlap: true }, axisLine: { lineStyle: { color: "#586575" } } }, yAxis: { type: "value", min: departure ? 18 : 0, axisLabel: { color: "#b9c5d6", formatter: departure ? (value: number) => formatClockMinute(Math.round(value * 60)) : undefined }, splitLine: { lineStyle: { color: "#34414e", type: "dashed" } } }, series: (departure ? ["下班时间"] : ["加班压力", "实际抵扣", "最终压力"]).map((name, index) => ({ name, type: "line", smooth: 0.15, data: values[index], symbolSize: 6, areaStyle: index === 2 ? { opacity: 0.08 } : undefined })) });
        this.charts.push(chart);
        this.observer ??= new ResizeObserver(() => this.charts.forEach((item) => item.resize()));
        this.observer.observe(host);
    }
    /** 创建按比例表达天数或小时数的横向统计条 */
    private bar(parent: HTMLElement, label: string, value: number, maximum: number, suffix: string, tone = "green"): void {
        // 单项分布条
        // 当前数据展示行
        const row = parent.createDiv({ cls: `pv-bar pv-${tone}` });
        row.createSpan({ text: label });
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
            // 统计日期输入控件
            const input = controls.createEl("input", { type: "date" }); input.value = field === "start" ? this.start : this.end; input.setAttribute("aria-label", field === "start" ? "起始日期" : "结束日期"); input.onchange = () => { if (!input.value)
                return; if (field === "start")
                this.start = input.value;
            else
                this.end = input.value; if (this.start > this.end)
                [this.start, this.end] = [this.end, this.start]; this.render(); }; });
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
        // 连续日或连续月份的账本汇总
        // 连续统计日期列表
        const dates = annual ? Array.from({ length: this.year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12 }, (_, i) => `${this.year}-${String(i + 1).padStart(2, "0")}`) : Array.from({ length: Math.min(3660, Math.round((Date.parse(this.end) - Date.parse(this.start)) / 86400000) + 1) }, (_, i) => shiftIsoDate(this.start, i));
        // 逐日期结算后的指标
        const totals = dates.map((date) => summarizePressureLedger(records.filter((record) => annual ? record.date.startsWith(date) : record.date === date), entries.filter((entry) => annual ? entry.date.startsWith(date) : entry.date === date), today, settings));
        this.trend(chart, dates.map((date) => annual ? `${Number(date.slice(5))}月` : date.slice(5)), [totals.map((item) => item.overtimeScore), totals.map((item) => item.appliedReliefScore), totals.map((item) => item.finalScore)]);
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
            renderReliefPanel(side, today, this.repository.get(today) ?? undefined, this.repository.listReliefEntries().filter((entry) => entry.date === today), settings, { onAdd: async (type, minutes) => { await this.repository.addReliefEntry(today, type, minutes); this.render(); }, onUndo: async (id) => { await this.repository.deleteReliefEntry(id); this.render(); } });
            this.button(side, "查看今日记录 →", () => this.navigate("每日记录", today));
            // 需要人工核对的记录区域
            const pending = this.panel(side, "需要处理");
            // 含缺失打卡或跨夜警告的考勤
            const unresolved = this.repository.list().filter((record) => this.pending(record.date));
            pending.createEl("p", { text: `${unresolved.length} 条待确认` });
            unresolved.sort((left, right) => right.date.localeCompare(left.date)).slice(0, 3).forEach((record) => this.button(pending, `${record.date} ${record.warnings[0] ?? "缺少打卡时间"} ›`, () => this.navigate("每日记录", record.date), "circle-alert", "pv-pending"));
            if (!unresolved.length)
                pending.createEl("p", { text: "当前没有待确认记录" });
            // 概览可切换图表区域
            const lower = this.panel(main);
            // 图表类型选择区域
            const tabs = lower.createDiv({ cls: "pv-tabs" });
            ["下班时间", "日历热力", "压力构成"].forEach((tab) => this.button(tabs, tab, () => { this.chartTab = tab; this.render(); }, undefined, this.chartTab === tab ? "is-active" : ""));
            if (this.chartTab === "日历热力")
                this.calendar(lower);
            else if (this.chartTab === "压力构成")
                metrics.departureBands.forEach((band) => this.bar(lower, band.label, band.count, Math.max(1, metrics.validAttendanceDays), "天", "pink"));
            else
                this.trend(lower, records.map((record) => record.date.slice(5)), [records.map((record) => record.endMinute === null ? null : record.endMinute / 60)], true);
        }
        body.createEl("small", { cls: "pv-footnote", text: "个人记录指标 · 解压仅抵扣当日压力 · 数据仅保存在本地" });
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
            // 按周一排列的日期网格
            const cells = calendar.createDiv({ cls: "pv-calendar-grid" });
            ["一", "二", "三", "四", "五", "六", "日"].forEach((day) => cells.createSpan({ text: `周${day}`, cls: "pv-weekday" }));
            // 当月首日用于推算星期空位
            const first = new Date(`${month}-01T00:00:00Z`);
            for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++)
                cells.createSpan();
            // 当前月份包含的自然日数量
            const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
            for (let day = 1; day <= days; day++) {
                // 当前日历单元对应日期
                const date = `${month}-${String(day).padStart(2, "0")}`;
                // 当前日期的考勤事实
                const record = this.repository.get(date);
                // 当日封顶抵扣后的压力结算
                const ledger = calculateDailyPressureLedger(date, record ?? undefined, this.repository.listReliefEntries().filter((entry) => entry.date === date), formatLocalIsoDate(new Date()), this.repository.getSettings().reliefActivities);
                // 可点击查看详情的日期按钮
                const cell = this.button(cells, String(day), () => this.navigate("每日记录", date));
                if (record?.endMinute !== null && record?.endMinute !== undefined)
                    cell.style.backgroundColor = `rgba(246,106,171,${0.08 + Math.min(ledger.overtimeScore / 12, 1) * 0.85})`;
                cell.title = `${date} · ${record?.endMinute == null ? "无有效下班时间" : formatClockMinute(record.endMinute)}`;
            }
        });
        parent.createDiv({ cls: "pv-calendar-legend", text: "无数据  ░ ▒ ▓ 压力由低到高 · 点击日期查看记录" });
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
        this.button(tools, "‹", () => { this.month = shiftIsoDate(`${this.month}-01`, -1).slice(0, 7); this.render(); });
        // 每日记录月份输入控件
        const month = tools.createEl("input", { type: "month" });
        month.value = this.month;
        month.setAttribute("aria-label", "记录月份");
        month.onchange = () => { if (month.value) {
            this.month = month.value;
            this.render();
        } };
        this.button(tools, "›", () => { this.month = shiftIsoDate(`${this.month}-01`, 32).slice(0, 7); this.render(); });
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
        // 已配置的解压活动定义
        const definitions = createReliefActivityDefinitions(settings);
        // 已停用事项的历史名称继续使用保存配置
        const historyDefinitions = createReliefActivityDefinitions(settings, true);
        // 连续统计日期列表
        const dates = [...new Set([...this.repository.list().map((record) => record.date), ...entries.map((entry) => entry.date)])].filter((date) => date.startsWith(this.month) && (this.filter === "全部" || (this.filter === "待处理" ? this.pending(date) : this.repository.get(date)?.manuallyEdited))).sort().reverse();
        if (!this.selected || !this.selected.startsWith(this.month))
            this.selected = dates[0] ?? `${this.month}-01`;
        // 按日期组织的考勤解压表格
        const table = list.createEl("table", { cls: "pv-table" });
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
            if (this.search && !`${date} ${reliefNames} ${record?.leaveReasons.join(" ")}`.includes(this.search))
                return;
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
            row.createEl("td", { text: `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` });
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
        if (!rows.children.length)
            list.createEl("p", { text: "当前条件下没有记录，请切换月份或新增记录。" });
        // 当前日期的考勤事实
        const record = this.repository.get(this.selected);
        // 所选日期的解压记录
        const dayEntries = entries.filter((entry) => entry.date === this.selected);
        // 当日封顶抵扣后的压力结算
        const ledger = calculateDailyPressureLedger(this.selected, record ?? undefined, dayEntries, today, settings);
        // 当前页面标题和操作区域
        const heading = detail.createDiv({ cls: "pv-heading" });
        heading.createEl("h2", { text: `${this.selected} · 周${"一二三四五六日"[(new Date(`${this.selected}T00:00:00Z`).getUTCDay() + 6) % 7]}` });
        // 上一日与下一日操作区域
        const arrows = heading.createDiv();
        [-1, 1].forEach((offset) => this.button(arrows, offset === -1 ? "‹" : "›", () => { this.selected = shiftIsoDate(this.selected, offset); this.month = this.selected.slice(0, 7); this.render(); }));
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
        // 事项快捷入口随数量与详情宽度自适应排列
        const shortcuts = relief.createDiv({ cls: "pv-relief-shortcuts" });
        definitions.forEach((definition) => this.button(shortcuts, `+ ${definition.label}`, () => { void this.repository.addReliefEntry(this.selected, definition.type, definition.incrementMinutes).then(() => this.render()); }, undefined, "pv-relief-add"));
        dayEntries.forEach((entry) => {
        // 当前数据展示行
        const row = relief.createDiv({ cls: "pv-relief-row" }); row.createSpan({ text: `${historyDefinitions.find((item) => item.type === entry.type)?.label ?? entry.type} · ${entry.durationMinutes} 分钟` }); row.createEl("strong", { cls: "pv-pink", text: `${calculateReliefScore([entry], settings)} 分` }); this.button(row, "", () => new ReliefEditModal(this.app, this.repository, entry, () => this.render()).open(), "pencil"); this.button(row, "", () => { void this.repository.deleteReliefEntry(entry.id).then(() => this.render()); }, "trash-2"); });
        relief.createEl("p", { text: `记录解压 ${ledger.reliefScore} 分，本日实际抵扣 ${ledger.appliedReliefScore} 分` });
        if (record?.warnings.length)
            detail.createEl("p", { cls: "pv-orange", text: `待确认：${record.warnings.join("；")}` });
    }
    /** 绘制可在弹窗预览的年度分享卡 */
    private shareCard(parent: HTMLElement): void {
        // 当前年份的真实压力账本
        // 当前周期的真实考勤记录
        const records = this.repository.list().filter((record) => record.date.startsWith(String(this.year)));
        // 本地解压活动记录
        const entries = this.repository.listReliefEntries().filter((entry) => entry.date.startsWith(String(this.year)));
        // 当日封顶抵扣后的压力结算
        const ledger = summarizePressureLedger(records, entries, formatLocalIsoDate(new Date()), this.repository.getSettings().reliefActivities);
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
        card.createEl("p", { cls: "pv-share-quote", text: "下班后，也是生活的一部分。" });
    }
    /** 打开独立年度卡片供本地截图分享 */
    private share(): void {
    // 本地详情或分享预览弹窗
    const modal = new Modal(this.app); modal.modalEl.addClass("pv-app", "pv-share-modal"); modal.setTitle("年度总结分享"); this.shareCard(modal.contentEl); modal.open(); }
}

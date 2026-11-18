import { setIcon } from "obsidian";
import { formatLocalIsoDate } from "../utils/date";

/** 创建日期与月份选择器共用的触发按钮、浮层和焦点行为 */
function createDatePicker(parent: HTMLElement, label: string, displayValue: string, showCaption: boolean) {
    // 按钮与浮层放在同一焦点区域内
    const wrapper = parent.createDiv({ cls: "pv-date-picker" });
    // 始终可通过键盘访问的日期入口
    const trigger = wrapper.createEl("button", { cls: "pv-date-trigger", attr: { "aria-label": `${label}：${displayValue}`, "aria-haspopup": "dialog", "aria-expanded": "false" } });
    setIcon(trigger.createSpan({ cls: "pv-date-icon" }), "calendar-days");
    // 日期用途与当前值分层显示
    const copy = trigger.createSpan();
    if (showCaption)
        copy.createEl("small", { text: label });
    copy.createSpan({ text: displayValue });
    // 与按钮共用焦点边界的日历浮层
    const panel = wrapper.createDiv({ cls: "pv-date-popover", attr: { role: "dialog", "aria-label": label } });
    panel.hidden = true;
    // 浮层可见性与辅助技术状态同步
    const setOpen = (open: boolean): void => { panel.hidden = !open; trigger.setAttribute("aria-expanded", String(open)); };
    wrapper.onkeydown = (event) => {
        if (event.key !== "Escape" || panel.hidden) return;
        event.stopPropagation();
        setOpen(false);
        trigger.focus();
    };
    wrapper.addEventListener("focusout", (event) => { if (!wrapper.contains(event.relatedTarget as Node | null)) setOpen(false); });
    return { trigger, panel, setOpen };
}

/** 渲染与概览主题统一的日期选择器，保持 ISO 日期筛选契约 */
export function renderDatePicker(parent: HTMLElement, label: string, value: string, onChange: (value: string) => void): void {
    // 复用日期筛选的入口与浮层
    const { trigger, panel, setOpen } = createDatePicker(parent, label, value.replace(/-/g, "."), true);
    // 当前浏览月份，使用本地中午避免时区跨日
    let month = new Date(`${value.slice(0, 7)}-01T12:00:00`);
    // 选择日期后交给概览统一校正起止顺序
    const choose = (date: string): void => { setOpen(false); trigger.focus(); onChange(date); };
    // 重绘当前月份及可选择的日期
    const render = (): void => {
        panel.empty();
        // 月份导航保留独立按钮，方便连续切换
        const header = panel.createDiv({ cls: "pv-date-header" });
        // 前后月份导航入口
        const previous = header.createEl("button", { attr: { "aria-label": "上个月" } });
        setIcon(previous, "chevron-left");
        header.createEl("strong", { text: `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`, attr: { "aria-live": "polite" } });
        // 后一个月入口
        const next = header.createEl("button", { attr: { "aria-label": "下个月" } });
        setIcon(next, "chevron-right");
        previous.onclick = () => { month.setMonth(month.getMonth() - 1); render(); panel.querySelector<HTMLButtonElement>("button")?.focus(); };
        next.onclick = () => { month.setMonth(month.getMonth() + 1); render(); panel.querySelectorAll<HTMLButtonElement>("button")[1]?.focus(); };
        // 周一开始的固定六周日期网格
        const grid = panel.createDiv({ cls: "pv-date-grid" });
        ["一", "二", "三", "四", "五", "六", "日"].forEach((day) => grid.createSpan({ cls: "pv-date-weekday", text: day }));
        // 当月第一天相对周一的偏移量
        const offset = (month.getDay() + 6) % 7;
        // 今天使用本地日期，不受 UTC 时差影响
        const today = formatLocalIsoDate(new Date());
        for (let index = 0; index < 42; index++) {
            // 网格中的真实日期，可直接选择相邻月份
            const date = new Date(month.getFullYear(), month.getMonth(), 1 - offset + index, 12);
            // 用于筛选与无障碍描述的完整日期
            const iso = formatLocalIsoDate(date);
            // 日期单元区分当前月、今天与选中日期
            const day = grid.createEl("button", { text: String(date.getDate()), cls: `${date.getMonth() !== month.getMonth() ? "is-outside" : ""} ${iso === value ? "is-selected" : ""} ${iso === today ? "is-today" : ""}`, attr: { "aria-label": iso, "aria-pressed": String(iso === value) } });
            day.onclick = () => choose(iso);
        }
        // 快捷返回今天，同时明确当前正在选择的边界
        const footer = panel.createDiv({ cls: "pv-date-footer" });
        footer.createSpan({ text: `选择${label}` });
        footer.createEl("button", { text: "今天" }).onclick = () => choose(today);
    };
    trigger.onclick = () => {
        if (!panel.hidden) { setOpen(false); return; }
        month = new Date(`${value.slice(0, 7)}-01T12:00:00`);
        render(); setOpen(true);
        panel.querySelector<HTMLButtonElement>(".is-selected")?.focus();
    };
}

/** 以中文月份网格切换每日记录，保留 YYYY-MM 筛选值 */
export function renderMonthPicker(parent: HTMLElement, value: string, onChange: (value: string) => void): void {
    // 选中年份也是每次打开浮层时的初始位置
    const selectedYear = Number(value.slice(0, 4));
    // 月份筛选沿用概览日期选择器的视觉样式
    const { trigger, panel, setOpen } = createDatePicker(parent, "记录月份", `${selectedYear} 年 ${Number(value.slice(5))} 月`, false);
    // 浏览年份独立于已选月份，切年时仅更新浮层
    let year = selectedYear;
    // 导航按钮固定挂载，切年时保留键盘焦点
    const header = panel.createDiv({ cls: "pv-date-header" });
    // 返回上一年的按钮
    const previous = header.createEl("button", { attr: { "aria-label": "上一年" } });
    setIcon(previous, "chevron-left");
    // 年份切换后向辅助技术播报当前展示年份
    const title = header.createEl("strong", { attr: { "aria-live": "polite" } });
    // 前往下一年的按钮
    const next = header.createEl("button", { attr: { "aria-label": "下一年" } });
    setIcon(next, "chevron-right");
    // 同一年的十二个月以四列网格排列
    const grid = panel.createDiv({ cls: "pv-date-grid pv-month-grid" });
    // 选择月份后关闭浮层并应用每日记录筛选
    const choose = (month: string): void => {
        setOpen(false);
        trigger.focus();
        if (month !== value)
            onChange(month);
    };
    // 网格同时突出当前选中的月份和本地本月
    const render = (): void => {
        title.textContent = `${year} 年`;
        grid.empty();
        // 本地本月用于高亮定位，避免 UTC 跨月偏差
        const currentMonth = formatLocalIsoDate(new Date()).slice(0, 7);
        // 从一月起依次生成该年各月份
        for (let month = 1; month <= 12; month++) {
            // 继续用原有的 ISO 月份值查询每日记录
            const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
            // 供鼠标和键盘选中月份的按钮
            const cell = grid.createEl("button", {
                text: `${month} 月`,
                cls: `${iso === currentMonth ? "is-today" : ""} ${iso === value ? "is-selected" : ""}`,
                attr: { "aria-label": `${year} 年 ${month} 月`, "aria-pressed": String(iso === value) },
            });
            cell.onclick = () => choose(iso);
        }
        previous.disabled = year <= 1;
        next.disabled = year >= 9999;
    };
    previous.onclick = () => { year--; render(); };
    next.onclick = () => { year++; render(); };
    // 快捷回到本月，历史筛选可一键恢复
    const footer = panel.createDiv({ cls: "pv-date-footer pv-month-footer" });
    footer.createEl("button", { text: "回到本月" }).onclick = () => choose(formatLocalIsoDate(new Date()).slice(0, 7));
    trigger.onclick = () => {
        if (!panel.hidden) { setOpen(false); return; }
        year = selectedYear;
        render();
        setOpen(true);
        grid.querySelector<HTMLButtonElement>(".is-selected")?.focus();
    };
}

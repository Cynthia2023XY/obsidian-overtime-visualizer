import { setIcon } from "obsidian";
import { formatLocalIsoDate } from "../utils/date";

/** 渲染与概览主题统一的日期选择器，保持 ISO 日期筛选契约 */
export function renderDatePicker(parent: HTMLElement, label: string, value: string, onChange: (value: string) => void): void {
    // 日期按钮及其独立浮层容器
    const wrapper = parent.createDiv({ cls: "pv-date-picker" });
    // 始终可通过键盘访问的日期入口
    const trigger = wrapper.createEl("button", { cls: "pv-date-trigger", attr: { "aria-label": `${label}：${value}`, "aria-haspopup": "dialog", "aria-expanded": "false" } });
    setIcon(trigger.createSpan({ cls: "pv-date-icon" }), "calendar-days");
    // 日期用途与当前值分层显示
    const copy = trigger.createSpan();
    copy.createEl("small", { text: label });
    copy.createSpan({ text: value.replace(/-/g, ".") });
    // 与按钮共用焦点边界的日历浮层
    const panel = wrapper.createDiv({ cls: "pv-date-popover", attr: { role: "dialog", "aria-label": label } });
    panel.hidden = true;
    // 当前浏览月份，使用本地中午避免时区跨日
    let month = new Date(`${value.slice(0, 7)}-01T12:00:00`);
    // 关闭日历并同步辅助技术状态
    const close = (): void => { panel.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
    // 选择日期后交给概览统一校正起止顺序
    const choose = (date: string): void => { close(); trigger.focus(); onChange(date); };
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
        if (!panel.hidden) { close(); return; }
        month = new Date(`${value.slice(0, 7)}-01T12:00:00`);
        render(); panel.hidden = false; trigger.setAttribute("aria-expanded", "true");
        panel.querySelector<HTMLButtonElement>(".is-selected")?.focus();
    };
    wrapper.onkeydown = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); trigger.focus(); } };
    wrapper.addEventListener("focusout", (event) => { if (!wrapper.contains(event.relatedTarget as Node | null)) close(); });
}

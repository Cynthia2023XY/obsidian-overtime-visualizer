import type { SummaryCardViewModel } from "../types/view-model";

/** 渲染仪表盘首屏指标卡 */
export function renderSummaryCards(containerEl: HTMLElement, cards: SummaryCardViewModel[]): void {
  /** 指标卡网格容器 */
  const gridEl = containerEl.createDiv({ cls: "otv-summary-grid" });

  cards.forEach((card) => {
    /** 单个指标卡根节点 */
    const cardEl = gridEl.createDiv({
      cls: `otv-summary-card otv-summary-card--${card.tone}`,
    });
    cardEl.createDiv({ cls: "otv-summary-card__label", text: card.label });
    cardEl.createDiv({ cls: "otv-summary-card__value", text: card.value });
    cardEl.createDiv({ cls: "otv-summary-card__detail", text: card.detail });
  });
}

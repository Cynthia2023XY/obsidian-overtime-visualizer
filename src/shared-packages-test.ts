import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { calculateDailyPressureLedger, createReliefActivityDefinitions } from "./analytics/pressure-ledger";
import { renderReliefPanel } from "./ui/relief-panel";

/** 每次验证后清理插件宿主中的共享组件节点 */
afterEach(() => { document.body.replaceChildren(); });

describe("插件固定版本共享包集成", () => {
  it("共享组件在插件宿主渲染并按共享配置触发解压记录", () => {
    // 插件接收共享 UI 触发的持久化请求
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderReliefPanel(document.body, "2026-10-19", undefined, [], DEFAULT_SETTINGS.reliefActivities, { onAdd, onUndo: vi.fn().mockResolvedValue(undefined) });
    // 共享核心生成的首个解压事项定义
    const definition = createReliefActivityDefinitions(DEFAULT_SETTINGS.reliefActivities)[0]!;
    // 用户实际点击组件中的解压事项
    const button = document.querySelector("button")!;
    expect(button.textContent).toContain(definition.label);
    button.click();
    expect(onAdd).toHaveBeenCalledWith(definition.type, definition.incrementMinutes);
  });

  it("打包依赖保留插件对无出勤日解压抵扣的原有规则", () => {
    // 无有效出勤时允许记录解压，但不会形成负压力或跨日抵扣
    const ledger = calculateDailyPressureLedger("2026-10-18", undefined, [{ id: "shared-relief", date: "2026-10-18", type: "sanlian", durationMinutes: 30, createdAt: 0 }], "2026-10-19", DEFAULT_SETTINGS.reliefActivities);
    expect(ledger.reliefScore).toBeGreaterThan(0);
    expect(ledger.appliedReliefScore).toBe(0);
    expect(ledger.finalScore).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createDashboardChartController } from "./chart-controller";

describe("图表生命周期控制器", () => {
  it("转发图表尺寸更新", () => {
    /** 测试使用的图表尺寸更新函数 */
    const resize = vi.fn();
    /** 测试使用的图表销毁函数 */
    const dispose = vi.fn();
    /** 测试使用的观察器断开函数 */
    const disconnect = vi.fn();
    /** 待验证的图表生命周期控制器 */
    const controller = createDashboardChartController({ resize, dispose }, { disconnect });

    controller.resize();
    expect(resize).toHaveBeenCalledOnce();
  });

  it("销毁时同时断开观察器并释放图表", () => {
    /** 测试使用的图表尺寸更新函数 */
    const resize = vi.fn();
    /** 测试使用的图表销毁函数 */
    const dispose = vi.fn();
    /** 测试使用的观察器断开函数 */
    const disconnect = vi.fn();
    /** 待验证的图表生命周期控制器 */
    const controller = createDashboardChartController({ resize, dispose }, { disconnect });

    controller.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("统一控制多个仪表盘图表", () => {
    /** 第一个图表的尺寸更新函数 */
    const firstResize = vi.fn();
    /** 第一个图表的销毁函数 */
    const firstDispose = vi.fn();
    /** 第二个图表的尺寸更新函数 */
    const secondResize = vi.fn();
    /** 第二个图表的销毁函数 */
    const secondDispose = vi.fn();
    /** 多图表共用的观察器断开函数 */
    const disconnect = vi.fn();
    /** 待验证的多图表生命周期控制器 */
    const controller = createDashboardChartController([
      { resize: firstResize, dispose: firstDispose },
      { resize: secondResize, dispose: secondDispose },
    ], { disconnect });

    controller.resize();
    controller.destroy();
    expect(firstResize).toHaveBeenCalledOnce();
    expect(secondResize).toHaveBeenCalledOnce();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

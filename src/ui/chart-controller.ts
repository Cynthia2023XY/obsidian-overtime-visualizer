/** 仪表盘图表组对外暴露的生命周期句柄 */
export interface DashboardChartController {
  resize: () => void;
  destroy: () => void;
}

/** 图表控制器需要的最小图表实例能力 */
export interface ManagedChart {
  resize: () => void;
  dispose: () => void;
}

/** 图表控制器需要的最小尺寸观察器能力 */
export interface ManagedResizeObserver {
  disconnect: () => void;
}

/** 创建确保图表与尺寸观察器成对清理的控制器 */
export function createDashboardChartController(
  chart: ManagedChart,
  resizeObserver: ManagedResizeObserver,
): DashboardChartController {
  return {
    /** 主动重算当前图表的尺寸 */
    resize: () => chart.resize(),
    /** 销毁尺寸观察器与图表实例 */
    destroy: () => {
      resizeObserver.disconnect();
      chart.dispose();
    },
  };
}

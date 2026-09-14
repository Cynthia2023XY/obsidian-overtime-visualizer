/** 影响考勤清洗与统计口径的插件设置 */
export interface OvertimeVisualizerSettings {
  startFloorMinute: number;
  endBenchmarkMinute: number;
  overnightCutoffMinute: number;
  releaseWeekdays: number[];
}

/** 与初版需求一致的默认统计口径 */
export const DEFAULT_SETTINGS: OvertimeVisualizerSettings = {
  startFloorMinute: 9 * 60,
  endBenchmarkMinute: 21 * 60,
  overnightCutoffMinute: 5 * 60,
  releaseWeekdays: [2, 4],
};

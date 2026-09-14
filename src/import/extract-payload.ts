/** 判断未知值是否为可读取键值的普通对象 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从完整 HR 响应、body.list、list 或数组中提取原始考勤列表 */
export function extractAttendanceList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) throw new Error("导入内容必须是 JSON 对象或数组");

  if (Array.isArray(payload.list)) return payload.list;
  if (isObject(payload.body) && Array.isArray(payload.body.list)) return payload.body.list;
  throw new Error("未找到考勤数组，请检查 body.list 或 list 字段");
}

/** 解析 JSON 文本并提取其中的原始考勤列表 */
export function parseAttendanceJson(source: string): unknown[] {
  /** Markdown 中所有非空 JSON 代码块的内容 */
  const fencedJsonSources = Array.from(source.matchAll(/```json\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim() ?? "")
    .filter((item) => item.length > 0);
  /** 需要分别解析并合并的 JSON 文本片段 */
  const jsonSources = fencedJsonSources.length > 0 ? fencedJsonSources : [source.trim()];

  return jsonSources.flatMap((jsonSource) => parseSingleAttendanceJson(jsonSource));
}

/** 解析单段 JSON 文本并提取其中的原始考勤列表 */
function parseSingleAttendanceJson(source: string): unknown[] {
  /** JSON 文本解析得到的未知数据 */
  let payload: unknown;
  try {
    payload = JSON.parse(source) as unknown;
  } catch {
    throw new Error("JSON 格式无效，请检查括号、引号和逗号");
  }
  return extractAttendanceList(payload);
}

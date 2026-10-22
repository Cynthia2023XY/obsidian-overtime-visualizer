/** 测试宿主使用原生 DOM 实现 Obsidian 创建元素的边界，插件代码仍使用宿主助手 */
function createTestElement<K extends keyof HTMLElementTagNameMap>(tag: K, options: DomElementInfo = {}): HTMLElementTagNameMap[K] {
  // 此处是宿主助手的底层实现，不能递归调用自身
  const element = document.createElement(tag);
  if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  if (options.text) element.append(options.text);
  // 将表单配置映射到可测试的 DOM 属性
  for (const key of ["type", "value", "placeholder"] as const) {
    if (options[key]) element.setAttribute(key, options[key]);
  }
  if (options.attr) Object.entries(options.attr).forEach(([key, value]) => { element.setAttribute(key, String(value)); });
  if (options.parent) options.parent.appendChild(element);
  return element;
}

/** 仅浏览器测试安装 DOM 宿主，Node 文件系统测试保持原环境 */
if (typeof HTMLElement !== "undefined") {
/** 给 DOM 测试安装与真实宿主同名的全局创建方法 */
Object.assign(window, {
  createEl: createTestElement,
  // 普通容器复用同一底层创建逻辑
  createDiv: (options?: DomElementInfo) => createTestElement("div", options),
  // 内联文本复用同一底层创建逻辑
  createSpan: (options?: DomElementInfo) => createTestElement("span", options),
});

/** 测试环境中补齐插件使用的 Obsidian 元素方法 */
Object.assign(HTMLElement.prototype, {
  // 保持选项与全局宿主助手一致，并挂到当前父元素
  createEl(this: HTMLElement, tag: keyof HTMLElementTagNameMap, options?: DomElementInfo) {
    return createTestElement(tag, { ...options, parent: this });
  },
  // 创建子容器，保留文本、样式和表单配置
  createDiv(this: HTMLElement, options?: DomElementInfo) { return createTestElement("div", { ...options, parent: this }); },
  // 创建内联子元素
  createSpan(this: HTMLElement, options?: DomElementInfo) { return createTestElement("span", { ...options, parent: this }); },
  // 重绘前移除旧子节点
  empty(this: HTMLElement) { this.replaceChildren(); },
  // 保留宿主支持多个类名的行为
  addClass(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); },
  // 状态标签和保存后的名称需要即时更新
  setText(this: HTMLElement, text: string) { this.textContent = text; },
});
}

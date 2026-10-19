import { toBlob } from "html-to-image";

/** 将完整年度分享卡绘制为高清 PNG，包含滚动区域之外的卡片内容 */
async function renderShareImage(card: HTMLElement): Promise<Blob> {
  await card.ownerDocument.fonts?.ready;
  // 卡片本身不滚动，使用边框尺寸避免装饰元素的溢出宽度被误算入图片
  const bounds = card.getBoundingClientRect();
  // 复制计算后的完整样式，由浏览器绘制字体、渐变与伪元素山形
  const image = await toBlob(card, {
    backgroundColor: "#161e29",
    pixelRatio: 2,
    width: Math.ceil(bounds.width),
    height: Math.ceil(bounds.height),
    // 分享卡使用本地界面字体，不扫描或下载其他插件的字体资源
    skipFonts: true,
    // 只调整图片副本，避免弹窗偏移及边框盒模型造成额外留白或裁切
    style: {
      margin: "0",
      transform: "none",
      boxSizing: "border-box",
    },
  });
  if (!image) throw new Error("分享图片生成失败，请重试");
  return image;
}

/** 在用户点击期间申请剪贴板写入，生成图片后完成复制 */
export async function copyShareImage(card: HTMLElement): Promise<void> {
  // 使用卡片所在窗口的剪贴板，兼容 Obsidian 弹出窗口
  const clipboard = card.ownerDocument.defaultView?.navigator.clipboard;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前环境不支持复制图片，请使用系统截图");
  }
  // 将生成任务直接交给剪贴板，避免异步绘制后丢失用户点击授权
  const image = renderShareImage(card);
  await Promise.all([image, clipboard.write([new ClipboardItem({ "image/png": image })])]);
}

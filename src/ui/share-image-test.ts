import { afterEach, describe, expect, it, vi } from "vitest";
import { toBlob } from "html-to-image";
import { copyShareImage } from "./share-image";

/** 图片绘制替换为画布边界，重点验证 PNG 编码与剪贴板行为 */
vi.mock("html-to-image", () => ({ toBlob: vi.fn() }));

/** 恢复浏览器全局对象，避免影响其他界面用例 */
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

/** 配置图片生成及可记录调用的剪贴板边界 */
function setupClipboard(blob: Blob | null = new Blob(["png"], { type: "image/png" })) {
  // 当前用例的系统剪贴板写入入口
  const write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("ClipboardItem", vi.fn(function (data: Record<string, Promise<Blob>>) { return { data }; }));
  vi.mocked(toBlob).mockResolvedValue(blob);
  return write;
}

describe("年度分享图片复制", () => {
  it("复制完整卡片的双倍分辨率 PNG，并在绘制完成前提交写入请求", async () => {
    // 监测写入的图片类型和异步生成任务
    const write = setupClipboard();
    // 模拟比弹窗可见高度更长的分享卡
    const card = createDiv();
    Object.defineProperties(card, { scrollWidth: { value: 700 }, scrollHeight: { value: 980 } });
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ width: 520, height: 980 } as DOMRect);
    // 用户点击发起的复制任务
    const copying = copyShareImage(card);
    expect(write).toHaveBeenCalledOnce();
    await copying;
    expect(toBlob).toHaveBeenCalledWith(card, expect.objectContaining({ pixelRatio: 2, skipFonts: true, width: 520, height: 980, style: { margin: "0", transform: "none", boxSizing: "border-box" } }));
    // 剪贴板接收 PNG 图片数据而非普通文本
    const item = vi.mocked(ClipboardItem).mock.calls[0]?.[0];
    expect(item).toHaveProperty("image/png");
    await expect(item?.["image/png"]).resolves.toHaveProperty("type", "image/png");
  });

  it("没有图片剪贴板能力时拒绝复制且不开始绘制", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyShareImage(createDiv())).rejects.toThrow("不支持复制图片");
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("PNG 编码失败时报告失败", async () => {
    setupClipboard(null);
    await expect(copyShareImage(createDiv())).rejects.toThrow("图片生成失败");
  });

  it("剪贴板拒绝写入时不会报告复制成功", async () => {
    // 模拟权限或系统剪贴板写入失败
    const write = setupClipboard();
    write.mockRejectedValue(new Error("剪贴板拒绝写入"));
    await expect(copyShareImage(createDiv())).rejects.toThrow("拒绝写入");
  });
});

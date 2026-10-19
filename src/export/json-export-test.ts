// @vitest-environment node
/* eslint-disable import/no-nodejs-modules -- 测试桌面导出边界，文件系统调用已全部模拟 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import { join } from "path";
import { createRequire } from "module";
import { Script } from "vm";
import { build } from "esbuild";
import { Notice, Platform, type App } from "obsidian";
import { exportJson } from "./json-export";

/** 模拟平台和消息提示，不依赖真实 Obsidian 进程 */
vi.mock("obsidian", () => ({ Platform: { isDesktopApp: true }, Notice: vi.fn(), normalizePath: (path: string) => path }));
/** 每个用例固定导出时间并恢复桌面平台 */
beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T08:00:00.000Z"));
    Platform.isDesktopApp = true;
    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
    vi.spyOn(os, "homedir").mockReturnValue("/test-user");
});
/** 避免测试时钟影响其他界面用例 */
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造可监测意外笔记库写入的宿主边界 */
function createApp() {
    // 显式保留模拟函数以验证写入边界，避免引用宿主未绑定方法
    const vault = { getAbstractFileByPath: vi.fn(), createFolder: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue(undefined) };
    return { app: { vault } as unknown as App, vault };
}

describe("默认导出位置", () => {
    it("打包产物在无动态导入回调的脚本宿主中可以实际写出 JSON", async () => {
        vi.restoreAllMocks();
        // 临时用户目录隔离真实磁盘验证，不写入个人下载目录
        const home = await fs.mkdtemp(join(os.tmpdir(), "overtime-export-"));
        try {
            // 按插件实际 CommonJS 方式打包，保留外部宿主与 Node 模块
            const bundle = await build({ entryPoints: ["src/export/json-export.ts"], bundle: true, platform: "node", format: "cjs", target: "es2018", external: ["obsidian"], write: false });
            // 模拟 Obsidian 为插件提供的 CommonJS 导出对象
            const module = { exports: {} as { exportJson: typeof exportJson } };
            // 真实 Node 模块读取能力仅用于临时目录集成验证
            const load = createRequire(import.meta.url);
            new Script(bundle.outputFiles[0]!.text).runInNewContext({ module, exports: module.exports, require: (id: string) => {
                if (id === "obsidian") return { Platform: { isDesktopApp: true }, Notice };
                if (id === "os") return { homedir: () => home };
                return load(id) as unknown;
            } });
            await module.exports.exportJson(createApp().app, "解压明细", { entries: [] });
            // 宿主没有动态 import 回调也应完成写入并保留导出契约
            const files = await fs.readdir(join(home, "Downloads"));
            expect(files).toHaveLength(1);
            expect(JSON.parse(await fs.readFile(join(home, "Downloads", files[0]!), "utf8"))).toEqual({ entries: [] });
        } finally {
            await fs.rm(home, { recursive: true, force: true });
        }
    });
    it.each(["考勤明细", "解压明细", "考勤脱敏备份"])("%s 写入下载目录并保持 JSON 数据完整", async (name) => {
        // 监测是否仍向笔记库创建备份
        const { app, vault } = createApp();
        // 可重新导入的示例导出契约
        const data = { body: { list: [{ attendanceDay: "2026.10.19" }] }, entries: [] };
        await exportJson(app, name, data);
        expect(fs.mkdir).toHaveBeenCalledWith(join("/test-user", "Downloads"), { recursive: true });
        expect(fs.writeFile).toHaveBeenCalledWith(join("/test-user", "Downloads", `${name}-2026-10-19T08-00-00-000Z.json`), JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx" });
        expect(vault.create).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("下载文件夹"));
    });

    it("写入被拒绝时明确提示失败且不在笔记库产生另一份备份", async () => {
        // 模拟下载目录权限不足
        const { app, vault } = createApp();
        vi.mocked(fs.writeFile).mockRejectedValue(new Error("EACCES"));
        await exportJson(app, "考勤明细", {});
        expect(Notice).toHaveBeenCalledOnce();
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
        expect(vault.create).not.toHaveBeenCalled();
    });

    it("移动端继续导出至笔记库且不加载桌面写入流程", async () => {
        Platform.isDesktopApp = false;
        // 移动端仍可使用原有备份位置
        const { app, vault } = createApp();
        await exportJson(app, "解压明细", { entries: [] });
        expect(vault.createFolder).toHaveBeenCalledWith("加班时长备份");
        expect(vault.create).toHaveBeenCalledWith("加班时长备份/解压明细-2026-10-19T08-00-00-000Z.json", JSON.stringify({ entries: [] }, null, 2));
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});

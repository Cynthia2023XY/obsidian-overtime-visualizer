import { type App, normalizePath, Notice, Platform } from "obsidian";

/** 将本地 JSON 导出到电脑下载目录，移动端继续使用笔记库备份目录 */
export async function exportJson(app: App, name: string, data: unknown): Promise<void> {
    try {
        // 保留原有 JSON 契约，确保导出数据可以重新导入
        const content = JSON.stringify(data, null, 2);
        // 文件名包含导出时刻，便于查找和区分多次备份
        const filename = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        if (Platform.isDesktopApp) {
            // 桌面端按需加载文件系统，避免影响移动端插件启动
            // eslint-disable-next-line no-undef, @typescript-eslint/no-require-imports, import/no-nodejs-modules -- Obsidian 脚本宿主需在桌面分支使用 CommonJS 加载
            const fs = (require("fs") as typeof import("fs")).promises;
            // 使用当前登录用户的主目录定位默认下载文件夹
            // eslint-disable-next-line no-undef, @typescript-eslint/no-require-imports, import/no-nodejs-modules -- 仅桌面端按需加载用户目录能力
            const os = require("os") as typeof import("os");
            // 使用当前操作系统的文件路径分隔规则
            // eslint-disable-next-line no-undef, @typescript-eslint/no-require-imports, import/no-nodejs-modules -- 仅桌面端按需加载路径能力
            const path = require("path") as typeof import("path");
            // 桌面端所有导出入口统一写入用户下载目录
            const directory = path.join(os.homedir(), "Downloads");
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(path.join(directory, filename), content, { encoding: "utf8", flag: "wx" });
            new Notice(`已导出${name}至下载文件夹：${path.join(directory, filename)}`);
        } else {
            // 移动端保留原有笔记库内备份能力
            const directory = normalizePath("加班时长备份");
            if (!app.vault.getAbstractFileByPath(directory)) await app.vault.createFolder(directory);
            await app.vault.create(normalizePath(`${directory}/${filename}`), content);
            new Notice(`已导出${name}至笔记库的${directory}文件夹`);
        }
    } catch (error) {
        // 保留真实异常，区分宿主加载、重名、权限与其他写入错误
        const reason = error instanceof Error ? error.message : String(error);
        new Notice(`导出${name}失败：${reason}`);
    }
}

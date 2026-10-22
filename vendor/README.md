# 插件固定版本共享包

- `overtime-visualizer-core-0.1.0.tgz`：统计、导入、数据模型、配置及迁移。
- `overtime-visualizer-ui-0.1.1.tgz`：不依赖 Obsidian/Electron 的通用界面、图表和样式。

这些 tarball 是发布依赖，需随插件仓库提交。`package.json` 和 `package-lock.json` 固定它们的路径与完整性；插件安装和构建不需要外部本地目录或符号链接。

唯一维护源码位于独立项目 `overtime-visualizer/packages/`。修改共享逻辑后先递增共享包版本，在独立项目运行 `npm run pack:shared`，复制新版本到本目录，并同步插件依赖和 lockfile；不要原地修改 tarball 或复用旧版本号。

插件 `styles.css` 是从 UI 包复制的安装产物，请修改共享 UI 源码中的样式，再按上述步骤更新包。

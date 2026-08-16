# Release logging policy Lab

这个 Lab 验证扩展的发布包不包含控制台日志，同时保留一个明确的开发构建入口。

## 契约

- `pnpm run build:extension` 是发布构建：压缩所有业务 bundle，移除
  `console.log/debug/info/trace/warn/error/time/timeEnd` 和 `debugger`，并在构建末尾扫描全部 JavaScript
  产物；任何遗漏都会让构建失败。
- `pnpm run build:extension:debug` 是开发构建：保留可读代码和控制台诊断；仓库根目录
  与 extension package 都提供同名命令。
- 移除 console 调用时只把调用标记为 pure；参数表达式仍会由 esbuild 按 JavaScript
  副作用规则保留，不能用 `drop: ['console']` 直接丢弃参数副作用。
- 第三方静态 `gif.js` 不经过 Vite，发布构建会单独移除它的三处诊断调用，然后再参加
  全包扫描。

## 验证步骤

在 `packages/extension` 执行：

```bash
pnpm exec vitest run scripts/release-build-policy.test.ts
pnpm run build:extension
pnpm run build:extension:debug
```

发布构建的最后一行必须报告扫描成功。开发构建完成后，可用下面的命令确认业务日志仍然存在：

```bash
rg -l 'console\.(log|debug|info|trace|warn|error|time|timeEnd)' build -g '*.js'
```

最后应再次执行 `pnpm run build:extension`，确保准备打包的 `build/` 是发布产物，而不是
开发产物。

## 浏览器验收

1. 加载 `packages/extension/build` 为 unpacked extension。
2. 依次打开 popup、开始/暂停/停止录制、进入 Studio、预览并导出 WebM。
3. 检查页面、Service Worker、offscreen document 和 worker 控制台；发布构建不得出现业务
   console 日志，功能错误仍必须通过界面状态或消息错误返回，而不是依赖控制台。
4. 换用 debug 构建重复一次，确认控制台诊断可见。

这个策略只减少发布包日志和体积，不替代结构化错误上报；本版没有新增远程遥测。

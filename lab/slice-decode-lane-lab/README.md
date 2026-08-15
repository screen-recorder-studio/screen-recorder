# Slice Decode Lane Lab

确定性复现生产 Worker 的竞态：主窗口解码未完成时收到下一窗口预取。旧实现立刻修改全局 `outputTarget`，使迟到的主窗口帧进入预取缓存；修复实现通过单 decoder lane 把预取延迟到主窗口 `flush()` 之后。

## 运行

启动仓库 Vite Lab 服务后打开：

`http://127.0.0.1:4179/lab/slice-decode-lane-lab/`

默认断言模拟 30 帧 4K 窗口仅输出首帧就触发预取。通过条件：

- 预取请求返回 `defer-prefetch`；
- 主解码期间 `outputTarget` 始终为 `current`；
- 主 `flush()` 后只启动一次最新预取；
- 当前窗口完整保留 30 帧。

# 发布执行手册

## 1. 冻结候选构建

1. 记录 branch、commit 和版本；确认不是在 `master` 上临时修改后直接签字。
2. 从同一 commit 执行正式扩展构建；不要混用旧 `build/`、旧 Worker 或旧 Popup。
3. 保存 build hash、Manifest 和测试环境；从 `build/` 加载 unpacked 扩展。
4. 重建后在 `chrome://extensions` 重载扩展，并关闭旧 Studio/Offscreen 页面。

## 2. 执行顺序

### 阶段 A：结构与 CLI 门禁

执行 GATE-001～006。任一 P0 失败，停止浏览器发布验收并先修复基线。

### 阶段 B：Smoke 用户主路径

按以下顺序执行：

1. ENTRY-001：标准 Tab 录制；
2. SESSION-001～004：倒计时、Popup 恢复、Pause/Resume、Stop；
3. STUDIO-001～003：精确交接、动态播放、Seek；
4. EDIT-002：Trim；
5. EXPORT-004 或 EXPORT-005：一个视频格式；
6. AREA-001～002、007：GIF 入口、区域录制和 fail-closed；
7. EXPORT-001～003：GIF 默认、真实动画和体积/预算；
8. MANAGER-001：列表与打开；
9. TRUST-001、A11Y-001：本地网络观察和主键盘路径。

Smoke 任一 P0 FAIL，不得生成“可发布”结论。

### 阶段 C：Full

- 执行所有 P0/P1 用例；
- 使用 ENV-CLEAN 和 ENV-UPGRADE 各一轮；
- MP4、WebM、GIF 均完成文件回读；
- Area 几何矩阵至少覆盖 100%/DPR1 和非默认 zoom/HIDPI；
- Manager 完成单删、批删、残缺数据和升级持久化；
- en、zh_CN 和一个 fallback locale；
- 连续三轮资源回收。

### 阶段 D：Extended

下列变更出现时必须扩展测试：

| 变更 | 强制扩展范围 |
| --- | --- |
| Manifest/权限/捕获 API | 多显示器、受限页面、安装/升级、隐私网络 |
| Area/crop/Canvas/resize | 全 DPR/zoom/边界矩阵 |
| WebCodecs/OPFS/Worker | 长时、SW 回收、浏览器重启、旧录制、低配 Windows |
| Studio decode/timeline | VFR、静态 hold、长 GOP、快速乱序 Seek |
| Export Worker/codec | 三格式、奇偶尺寸、硬件回退、取消清理、大文件 |
| 全局 UI/i18n | 全键盘、对比度、窄宽度和 locale fallback |

## 3. 缺陷闭环

对每个 FAIL：

1. 保留原始状态，不通过刷新、重装或删除 OPFS 隐藏问题；
2. 记录最小复现、预期、实际、环境、operationId/recordingId 和证据；
3. 判断是产品、测试数据、浏览器限制还是环境问题；
4. 对确定性逻辑先补失败自动化测试；对平台假设先进入独立 Lab；
5. 修复后依次重跑直接用例、同域回归、Smoke 和 CLI 门禁；
6. 报告中保留缺陷和修正记录，不覆盖第一次失败证据。

## 4. 发布判定

### 可发布

- P0 全 PASS；
- P1 全 PASS，或仅有已接受且不影响主路径的限制；
- 所有导出产物完成回读；
- 当前目标平台和覆盖范围写清楚；
- 没有未解释的数据丢失、媒体外传、权限扩大或资源泄漏。

### 灰度可发布

- 所有已执行平台的 P0 全 PASS；
- 另一平台/Extended 场景未执行但风险被明确限制；
- 发布渠道、用户范围和回滚条件已记录。

### 不可发布

- 任一 P0 FAIL；
- GIF 文件存在但画面静止；
- Area 录入选区外隐私内容或错误缩放；
- Stop/Finalize 产生重复或残缺录制；
- Studio 打开错误 recording；
- 编辑预览与导出不一致；
- 删除错误录制、升级丢失 OPFS 或出现媒体外传；
- BLOCKED 被写成 PASS，或关键产物没有证据。

## 5. 报告归档

1. 复制 [EXECUTION-REPORT-TEMPLATE.md](./EXECUTION-REPORT-TEMPLATE.md)。
2. 文件名使用 `EXECUTION-REPORT-<version>-<YYYYMMDD>.md`。
3. 报告提交到本目录；大文件证据保存在外部/忽略目录。
4. 报告必须列出 NOT RUN、BLOCKED、N/A 和已知限制，不能只列 PASS。
5. 下一版本先读上一份报告，优先复验遗留风险和修复项。

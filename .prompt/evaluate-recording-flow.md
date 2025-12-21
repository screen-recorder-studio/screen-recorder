请端到端评估**视频录制流程（生产端）**，重点关注其为下游编辑和导出所定义的“数据契约”完整性：

1、UI 控制层：@src/routes/control/+page.svelte (参数选择与指令发送)
2、逻辑调度层：@src/extensions/background.ts (生命周期与配置分发)
3、媒体执行层：@src/extensions/offscreen-main.ts (WebCodecs 编码与流控制)
4、高性能写入：@src/extensions/opfs-writer.ts (数据持久化与索引生成)

评估重点：
- **元数据契约完备性**：分析生成的 `meta.json` 是否包含下游 Studio 所需的所有关键信息（如原始分辨率、色彩空间、精确 FPS、编码 Profile）。
- **文本清晰度源头保护**：评估是否通过 `contentHint: 'text'` 建立了清晰度基准，并检查 WebCodecs 初始化码率是否为 4K 高保真文字留足了空间。
- **关键帧策略（GOP）**：评估关键帧间隔设置。是否考虑了下游 Studio 随机 Seek 的性能？如果 GOP 太大，下游预览会卡顿；如果太小，则影响录制性能。
- **索引文件的鲁棒性**：检查 `index.jsonl` 中的偏移量和时间戳（μs）写入逻辑。如果录制意外中断，索引是否能保持部分可用以供 Studio 挽救？
- **控制链路状态同步**：评估倒计时与 Badge 状态在跨进程中的一致性，确保用户在“准备录制”到“正式录制”的切换中感知平滑。
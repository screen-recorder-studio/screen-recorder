# Chrome WebCodecs H.264 Dimension Probe

独立的最小 MV3 Chrome 扩展，用于区分两类结论：

1. 当前 Chrome 是否通过 `VideoEncoder.isConfigSupported()` 宣称支持 H.264 的 1920×1080、1919×1079、1920×1088；
2. 1920×1080 是否真正走完 `configure → encode → flush`，并产生非空 `EncodedVideoChunk`。

它不读取或修改主扩展，也没有权限、依赖和网络请求。

## 固定测试配置

- Codec：`avc1.640028`（H.264 High Profile @ Level 4.0）
- Bitrate：8,000,000 bps
- Framerate：30 fps
- Latency：`realtime`
- Hardware acceleration：`no-preference`
- AVC bitstream：Annex B

选择完整的 `avc1.*` 字符串是因为 WebCodecs 的 AVC 注册要求 codec string 明确描述 profile、level 和 constraint bits。`isConfigSupported()` 只证明浏览器接受配置；实际编码测试会另外创建三帧 1920×1080 Canvas `VideoFrame`、编码、`flush()`，并要求至少收到一个非空输出 chunk。

参考一手资料：

- [Chrome WebCodecs 指南](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [W3C WebCodecs — VideoEncoder](https://www.w3.org/TR/webcodecs/#videoencoder-interface)
- [W3C AVC (H.264) WebCodecs Registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)

## 手工步骤

1. 在 Chrome 打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录：`lab/webcodecs-h264-probe/`。
4. 点击工具栏中的 “WebCodecs H.264 Dimension Probe” 图标。
5. 点击“运行全部测试”，等待按钮变为“重新运行”。通常只需数秒。
6. 检查三行 `isConfigSupported` 结果，以及 “1920 × 1080 实际编码” 是否为 PASS。
7. 点击“复制报告”；若剪贴板被策略阻止，展开“原始 JSON 报告”后手动复制。
8. 在报告中保留完整 `Chrome / UA`、三个尺寸结果、实际编码的 chunk 数/总字节数和 `decoderConfig`，用于和生产路径判断对照。

## 结果解释

- `SUPPORTED`：Chrome 接受该声明配置，但不单独证明实际编码一定成功。
- `ERROR`：配置字典本身被拒绝；报告会保留异常名和信息。
- 实编 `PASS`：1920×1080 的三帧已完成 `flush()`，并收到至少一个有字节的 chunk。
- 实编 `FAIL`：查看阶段列表判断失败位于 Canvas、构造、configure、encode、异步 error callback 还是 flush。
- 1919×1079 为刻意的奇数尺寸探针；不得把它的结果外推为所有 H.264 实现或所有 profile 都具备同样限制。

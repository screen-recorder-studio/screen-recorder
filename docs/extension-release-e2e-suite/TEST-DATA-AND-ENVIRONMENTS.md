# 测试数据、环境与证据

## 1. 每轮必须记录

- 版本、commit、分支和构建时间；
- Chrome 精确版本、扩展 ID、安装方式与 Manifest 版本；
- OS、CPU/GPU、内存、显示器数量、分辨率、DPR 和系统缩放；
- 页面 zoom、硬件加速状态、扩展 locale；
- 全新安装、升级安装或保留 OPFS 数据；
- 测试层级：Smoke、Full 或 Extended；
- 未执行平台和被阻断的外部条件。

## 2. 环境矩阵

| 环境 ID | 环境 | 最低发布要求 |
| --- | --- | --- |
| ENV-CLI | 当前工作区 Node/pnpm | 每个候选构建 |
| ENV-MAC-STABLE | 当前 Chrome Stable + macOS | macOS 发布或 Full 主环境 |
| ENV-WIN-STABLE | 当前 Chrome Stable + Windows 11 | 全平台签字必需 |
| ENV-WIN-LOW | 4 核/8 GB 左右、集显 Windows | Extended 性能签字 |
| ENV-HIDPI | DPR 2 或更高，125%/150% 系统缩放 | Area 几何和 Studio 视觉 |
| ENV-MULTI | 双显示器、两个 Chrome 窗口 | Window/Screen Extended |
| ENV-CLEAN | 新 Chrome Profile，无旧 OPFS | 首次安装/默认设置 |
| ENV-UPGRADE | 已安装上一发布版且有录制数据 | 升级兼容和数据保留 |

若只执行一个桌面平台，结论最多为“该平台灰度可发布”，不得写“全平台通过”。

## 3. 标准页面与数据

### DATA-01 普通 HTTPS 页面

- 使用 `https://example.com` 或团队固定的无登录 HTTPS fixture；
- 用于标准 Tab、Window、Screen 入口和基础恢复。

### DATA-02 GIF Motion Lab

- 路径：`packages/extension/test-pages/gif-lab/`；
- 必须同时包含连续运动、离散状态变化、1px 线、文字、色阶和静态区域；
- 页面显示单调递增的 frame/clock 标识，便于判断是否录到静止画面；
- 测试服务器必须用 HTTP(S) 访问，不能依赖 `file://` 权限。

### DATA-03 Area 几何矩阵

| 页面 zoom | DPR | 选区 CSS px | 断言 |
| ---: | ---: | --- | --- |
| 100% | 1 | 320×180 | 源 crop 对应选区，无外部边框 |
| 100% | 2 | 320×180 | 输出源像素约 640×360，允许编码对齐但不拉伸 |
| 125% | 2 | 321×181 | crop clamp/对齐正确，无 1px 漂移累积 |
| 80% | 1/2 | 靠右下边界 | 不越过源帧，不出现黑边 |

### DATA-04 标准编辑素材

- 时长 12～20 秒；
- 前 2 秒静止，中间连续运动，末尾状态变化；
- 包含可识别左上/中心/右下标记；
- 用于 Crop、Trim、Focus、背景与三格式 parity。

### DATA-05 稀疏/VFR/静态 Hold

- 复用 [旧技术套件 DATA-02/03/05](../recording-e2e-test-suite/TEST-ENVIRONMENT-AND-DATA.md)；
- 用于 Studio Seek、静态段时钟和导出时长。

### DATA-06 历史录制

- 上一发布版生成且完整的 OPFS 目录；
- 缺少新 meta 字段但数据合法的兼容 fixture；
- 不得用当前版本重新生成后冒充历史数据。

### DATA-07 残缺录制

- 缺少 `index.jsonl`；
- 缺少 `data.bin`；
- meta 未完成；
- 尾部 index/data 长度不匹配；
- 用于 Manager 和 Studio fail-safe，不用于证明正常录制成功。

### DATA-08 背景与构图

- 纯色、线性/径向渐变、内置壁纸；
- 本地上传 PNG/JPEG/WebP，含透明和超大图片；
- 1:1、4:3、16:9、9:16 及自定义 Crop。

### DATA-09 Locale

- `en`、`zh_CN` 为每版必测；
- 任一缺少新增 key 的 locale 用于 fallback 验证；
- 文本增长 locale 用于窄宽度和按钮溢出。

### DATA-10 长时与资源回收

- 三轮连续 `录制 30 秒 → Studio → 导出 → 关闭`；
- Extended：10/30/60 分钟录制，按变更风险选择；
- 记录 live track、Worker 数、JS heap/进程内存、OPFS 增量和导出耗时。

## 4. 导出文件回读

每个输出文件至少记录：

- 文件名、格式签名、MIME、实际字节数；
- 显示宽高、帧/样本数、总时长和循环信息；
- 首帧、1/2 时长和末帧截图或像素摘要；
- 是否包含 Trim/Crop/Focus/背景效果；
- GIF 是否至少有两个视觉不同的展示帧；
- UI 估算区间与实际体积的关系。

允许使用 `ffprobe`、MediaInfo、浏览器解码、GIF parser 或仓库产物 inspector。不能只用文件扩展名作为格式证据。

## 5. 证据目录

建议每轮在仓库外或被 `.gitignore` 覆盖的位置保存大文件：

```text
evidence/<version>/<run-id>/
  environment.json
  commands/
  screenshots/
  recordings/
  exports/
  network/
  console/
  metrics/
```

证据文件名：

```text
<case-id>__<environment-id>__<step>__<timestamp>.<ext>
```

发布报告只链接证据，不把大体积视频、GIF、ZIP 或商店截图直接提交到源码历史。

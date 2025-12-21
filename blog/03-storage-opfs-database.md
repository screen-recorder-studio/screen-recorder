# 浏览器端的时序数据库：基于 OPFS 的视频流存储引擎

> **摘要**: 处理 GB 级别的视频流数据时，传统的浏览器存储方案（IndexedDB, Blob）往往力不从心。本文详细解析 Screen Recorder Studio 如何利用 OPFS 的同步访问句柄（SyncAccessHandle），构建一套类似于日志结构文件系统（LFS）的高吞吐量、可崩溃恢复的本地存储引擎。

---

## 快速开始：源码与体验

*   **GitHub 源码**：访问 <https://github.com/screen-recorder-studio/screen-recorder>，欢迎加星支持。
*   **安装体验**：在 Chrome 应用市场搜索 **Screen Recorder Studio**，即可安装体验。

## 1. 存储困境：当 Blob 遇到 GB 级数据

在 Web 前端，处理文件的标准做法是将数据累积在 `Blob` 数组中，最后一次性导出。然而，对于长时屏幕录制场景，这种内存驻留（In-Memory）模式存在致命缺陷：

1.  **内存墙 (Memory Wall)**: 1 小时的 4K/60FPS 编码数据量约为 4~8 GB。浏览器的单标签页内存限制（通常 4GB）意味着长录制必然导致崩溃（OOM）。
2.  **I/O 阻塞**: 即使使用 `IndexedDB` 分片存储，其异步事务模型在高频（60Hz）写入下会产生巨大的 Promise 调度开销，导致 Event Loop 阻塞，反过来影响视频编码的稳定性。

我们需要一种能够**绕过主线程**、**直接操作磁盘**且**实时落盘**的机制。

### 我们真正要解决的问题

从工程视角看，“把视频写到本地”至少包含四个互相制约的目标：

1.  **吞吐**：60FPS 下持续写入，不能拖垮编码链路。
2.  **时序可检索**：能按时间快速定位（Seek），并支持编辑器按窗口拉取数据。
3.  **可恢复**：浏览器崩溃/进程重启后，尽可能保留已写入的数据。
4.  **可导出**：存储结构要能在后处理阶段封装成可播放的 WebM/MP4。

---

## 2. 破局者：OPFS 与同步 I/O

Chrome 102+ 引入的 **Origin Private File System (OPFS)** 提供了一个特殊的接口：`FileSystemSyncAccessHandle`。它仅在 Dedicated Worker 中可用，允许开发者执行同步的文件读写操作。

### 为什么 SyncAccessHandle 更快？
与传统的 `FileWriter` 或 `Blob.stream()` 相比，同步句柄有本质区别：
*   **零上下文切换**：写入操作在 Worker 线程原地阻塞执行，直接调用底层文件系统 API，无需在该线程的事件循环中排队。
*   **缓冲区复用**：支持使用 `DataView` 或 `TypedArray` 进行原地读写（In-place R/W），减少了数据在 JS 堆与原生堆之间的复制。

这使得 JavaScript 第一次拥有了堪比 C/C++ `fwrite` 的 I/O 性能。

### 约束：为什么必须是 Dedicated Worker？

`FileSystemSyncAccessHandle` 的定位是“高性能、可阻塞的文件访问”。为了避免阻塞 UI 线程和事件循环，它被严格限制在 Dedicated Worker 中使用。这也是为什么 Screen Recorder Studio 会把 OPFS 写入放进专门的 writer worker：录制链路里任何一次阻塞都可能引入掉帧和音画不同步。

---

## 3. 存储引擎设计：索引与数据分离

为了实现高效写入与快速检索，我们在“录制阶段”不直接生成传统容器文件（例如 MP4）。这是因为经典 MP4 往往需要在结束时补齐或回写关键信息（例如 `moov`），而频繁地随机写入会显著降低稳定性与吞吐。我们转而设计了一种**类似于时序数据库**的存储结构：把“数据”与“索引/元信息”解耦，先保证持续追加写入，再在导出阶段封装成 WebM/MP4。

每个录制会话（Session）被映射为一个目录，包含三个核心文件：

### 3.1 `data.bin` (Write-Ahead Log)
这是纯粹的负载数据文件。所有的 `EncodedVideoChunk` 按照时间顺序被直接追加（Append）到文件末尾。

*   **写入策略**：纯追加写，无回溯。这最大化了磁盘的顺序写入吞吐量。
*   **内容**：不包含任何容器元数据，只有原始的 VP9/H.264 码流。

这种设计有一个重要好处：写入路径只需要维护一个单调递增的 `offset`（当前写入位置），不需要回头修改任何已写入内容，天然适配“高频小块追加”的录屏场景。

### 3.2 `index.jsonl` (Seek Table)
这是一个稀疏索引文件，采用 JSON Lines 格式。每一行记录了一帧数据的物理位置与属性：

```json
{"offset":0,"size":45023,"timestamp":0,"type":"key","isKeyframe":true,"codec":"vp09.00.10.08","codedWidth":3840,"codedHeight":2160}
{"offset":45023,"size":1204,"timestamp":33333,"type":"delta","isKeyframe":false}
```

*   **offset/size**: 指向 `data.bin` 中的物理字节范围。
*   **timestamp**: 编码块时间戳（通常是微秒级），用于导出封装与时间线对齐。
*   **type**: `key` / `delta`，用于 Seek 与后续封装策略（例如更快定位到可解码的起点）。
*   **codec / codedWidth / codedHeight**: 作为导出/预览阶段的辅助信息，避免重复探测。

### 3.3 `meta.json` (Superblock)
存储会话的全局元数据，如分辨率、帧率、编码器配置字符串（Codec String）以及录制总时长。

在实现中，`meta.json` 还会包含一些“完成态”字段（例如 `completed`、`totalBytes`、`totalChunks`、`duration`、`firstTimestamp`、`lastTimestamp`），用于判断一次会话是否正常结束，以及用于 UI 展示与导出预检查。

---

## 4. 核心实现：双级缓冲写入

在 `opfs-writer-worker.ts` 中，我们实现了一个简单的双级缓冲机制来平衡 I/O 频率。

```typescript
// src/lib/workers/opfs-writer-worker.ts

// 第一级：数据流同步直写
const written = accessHandle.write(u8Buffer, { at: currentOffset })

// 第二级：索引流内存缓冲
// index.jsonl 是文本文件，频繁的小 IO 写入效率极低
pendingIndexLines.push(metaLine);

// 批量刷盘策略
if (chunksWritten % 100 === 0) {
  // 每 100 帧（约 3 秒）执行一次索引落盘
  flushIndexToFile();
}
```

这种策略保证了视频数据（最重要、最大）的实时性，同时将索引（较小、可重建）的 I/O 开销降到最低。

补充一点：为了提高兼容性，工程实现也包含降级路径——当 `createSyncAccessHandle` 不可用时，会暂存分片并在结束时一次性写入文件。该路径不具备“无限时长”的优势，但能在不支持同步句柄的环境中保持功能可用。

### 写入协议：init / append / flush / finalize

从系统层面看，OPFS writer 的职责不是“理解视频格式”，而是提供一个可靠的 append-only 写入服务。写入协议可以抽象为四类消息：

*   `init`：创建会话目录 `rec_<id>`，初始化 `data.bin`，写入初始 `meta.json`，并返回 `ready`。
*   `append`：写入一段二进制数据到 `data.bin` 指定偏移；同时把对应索引行追加到内存缓冲。
*   `flush`：把 `index.jsonl` 批量落盘（数据句柄在同步写入路径上不必每次 flush）。
*   `finalize`：写入最终 `meta.json`（标记完成、写入统计信息），并返回 `finalized`。

这样的协议设计让写入路径尽可能简单：只关心“字节块 + 元信息”，把容器封装与编解码细节留给后续导出。

### 一致性与可恢复性：我们能保证什么？

在浏览器环境里，“强一致 + 断电级持久化”并不是免费得到的。更现实的目标是：

*   **顺序追加 + 最小化状态**：只维护 `offset`，避免复杂的跨文件事务。
*   **元信息双阶段**：开始时写 `completed=false`，结束时写 `completed=true`，从而能快速识别“未正常结束的录制会话”。
*   **索引可容忍延迟**：索引延迟落盘意味着“最后一小段索引可能缺失”，但不会破坏此前已落盘的数据结构。

---

## 5. 工程价值：崩溃恢复 (Crash Recovery)

这套存储引擎最大的工程价值在于其**容错性**。

在浏览器崩溃（Tab Crash）或进程被系统强杀等极端情况下：
1.  **数据尽可能保留**：`data.bin` 采用顺序追加写入，且写入发生在 Dedicated Worker 中。最终的持久化程度仍取决于浏览器与操作系统的写回策略，因此工程上会在结束时进行一次明确的关闭/刷新流程，以最大化落盘成功率。
2.  **索引可容忍丢失**：索引文件是“辅助结构”。即使 `index.jsonl` 丢失最后一小段（例如未及时刷盘的几十/上百条），也通常可以通过“截断末尾未索引的数据”来恢复绝大部分内容，而无需对原始码流做复杂扫描解析。
3.  **导出解耦**：录制阶段只关心“持续、稳定、可恢复的追加写”。后续 Studio/导出 Worker 再根据 `data.bin + index.jsonl + meta.json` 封装成 WebM/MP4，从而把复杂度从实时链路中移出。

### 一个务实的恢复流程

当应用重启后，如果发现某个会话目录 `rec_<id>` 的 `meta.json` 标记为 `completed=false`，可以按以下方式做“最大化保留”：

1.  读取 `index.jsonl`，获得已落盘的最后一个条目 `lastIndexedOffset`。
2.  视需要对 `data.bin` 执行一次截断（truncate）到 `lastIndexedOffset`（或直接忽略后续尾部数据）。
3.  更新 `meta.json`：写入“恢复后可用长度/时长”等信息，并在 UI 中提示“该录制未正常结束，已恢复到最后一个索引点”。

这套流程的关键是：我们不尝试在没有 framing 的前提下解析原始码流，只依赖“已经写入的索引”来保证可用性。

---

## 6. 读路径：面向 Studio 的 Seek 与窗口读取

存储引擎只有“写得进”还不够，编辑器更关心“能不能快速读”。在 Screen Recorder Studio 里，Studio 会通过 OPFS reader worker 打开会话目录并按需读取窗口数据（实现见 `src/lib/workers/opfs-reader-worker.ts`）。

### 6.1 打开与摘要（Summary）

打开会话时，reader 会读取 `meta.json` 与 `index.jsonl`，并构建一个摘要：

*   `totalChunks / totalBytes`：快速估算录制规模。
*   `durationMs`：通过 `lastTimestamp - firstTimestamp` 计算相对时长。
*   `keyframeIndices / keyframes`：为 Seek 做准备。

### 6.2 Seek：先对齐关键帧，再拉窗口

由于视频解码通常需要从关键帧开始，Seek 的基本策略是：

1.  根据目标时间（毫秒）二分查找定位到最近的 chunk。
2.  向前回溯到最近关键帧（`type=key` 或 `isKeyframe=true`）。
3.  以“关键帧起点 + 一段时间窗口”读取数据，让解码器可以顺利解码并快速赶上目标点。

### 6.3 批量读取：把 N 次 I/O 变成 1 次

对于连续的一段窗口（例如从第 `startIdx` 到 `endIdx`），reader 不会逐条读取每个 chunk，而是：

1.  根据索引计算 `[startOffset, endOffset)` 的连续字节范围。
2.  对 `data.bin` 执行一次 `slice(startOffset, endOffset).arrayBuffer()`。
3.  再按每条索引的 `offset/size` 把大缓冲切片成单个 chunk 的 `ArrayBuffer`，通过 Transferable 回传给主线程。

这样做的收益很直接：把“几十到几百次小 I/O”合并为“一次大 I/O”，显著减少调度与系统调用开销。

---

## 7. 空间管理与清理策略

OPFS 属于站点私有存储，受浏览器配额限制。对于录屏这种 GB 级数据，必须考虑空间管理：

*   **会话目录化**：每个录制一个 `rec_<id>` 目录，便于列举、统计与删除。
*   **删除即回收**：删除整个目录通常是最简单可靠的回收手段（比逐文件删除更不易漏）。
*   **导出后策略**：对用户而言，“导出成品文件”与“保留工程文件”是两件事；可以根据产品定位提供自动清理选项。

---

## 8. 局限与下一步

这种“数据 + 索引 + meta”的布局是为稳定与吞吐而设计的，也有边界：

*   `data.bin` 是原始码流，不是最终容器；必须经过导出/封装才能被普通播放器直接播放。
*   `index.jsonl` 是文本索引，规模很大时需要进一步优化（例如分段索引、二级索引、二进制索引）。
*   reader 目前通过 `File.slice` 读取数据，后续可以升级为 SyncAccessHandle 读路径，以进一步降低开销。

## 结论

通过将**日志结构文件系统**的设计思想引入浏览器端，Screen Recorder Studio 成功解决了长视频录制的持久化难题。这种“数据优先、索引辅助”的存储引擎，为 Web 应用处理本地大规模多媒体数据提供了一种高可靠的范式。

---

## 进一步了解

*   GitHub：<https://github.com/screen-recorder-studio/screen-recorder>
*   Chrome 应用市场：搜索 **Screen Recorder Studio**

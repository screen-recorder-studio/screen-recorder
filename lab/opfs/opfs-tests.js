// OPFS API 测试验证脚本

let testCounter = 0;

// 日志记录函数
function log(message, type = 'info') {
    const logs = document.getElementById('logs');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function clearLogs() {
    document.getElementById('logs').innerHTML = '';
}

// 检查 OPFS 支持状态
function checkOpfsSupport() {
    const statusDiv = document.getElementById('support-status');
    
    if (!navigator.storage?.getDirectory) {
        statusDiv.innerHTML = '<div class="status unsupported">❌ OPFS 不受支持 - 需要 HTTPS 环境和现代浏览器</div>';
        return false;
    }
    
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
    if (!isSecure) {
        statusDiv.innerHTML = '<div class="status unsupported">⚠️ OPFS 需要安全上下文 (HTTPS)</div>';
        return false;
    }
    
    statusDiv.innerHTML = '<div class="status supported">✅ OPFS 受支持</div>';
    return true;
}

// 基础 OPFS 测试
async function testBasicOpfs() {
    try {
        log('开始基础 OPFS 测试...', 'info');
        
        // 获取根目录
        const root = await navigator.storage.getDirectory();
        log('✅ 成功获取 OPFS 根目录', 'success');
        
        // 创建测试文件
        const fileName = `test-basic-${++testCounter}.txt`;
        const fileHandle = await root.getFileHandle(fileName, { create: true });
        log(`✅ 创建文件句柄: ${fileName}`, 'success');
        
        // 写入数据
        const writable = await fileHandle.createWritable();
        await writable.write('Hello OPFS! 这是基础测试数据。');
        await writable.close();
        log('✅ 使用 createWritable 写入数据', 'success');
        
        // 读取数据
        const file = await fileHandle.getFile();
        const text = await file.text();
        log(`✅ 读取数据: "${text}" (${file.size} 字节)`, 'success');
        
        log('🎉 基础 OPFS 测试完成', 'success');
        
    } catch (error) {
        log(`❌ 基础 OPFS 测试失败: ${error.message}`, 'error');
    }
}

// 文件操作测试
async function testFileOperations() {
    try {
        log('开始文件操作测试...', 'info');
        
        const root = await navigator.storage.getDirectory();
        const fileName = `test-file-ops-${++testCounter}.bin`;
        
        // 创建文件
        const fileHandle = await root.getFileHandle(fileName, { create: true });
        log(`✅ 创建文件: ${fileName}`, 'success');
        
        // 写入二进制数据
        const binaryData = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
        const writable = await fileHandle.createWritable();
        await writable.write(binaryData);
        await writable.close();
        log('✅ 写入二进制数据', 'success');
        
        // 读取并验证
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        const readData = new Uint8Array(arrayBuffer);
        
        const isEqual = readData.every((byte, index) => byte === binaryData[index]);
        log(`✅ 数据验证: ${isEqual ? '通过' : '失败'}`, isEqual ? 'success' : 'error');
        
        // 删除文件
        await fileHandle.remove();
        log('✅ 删除文件', 'success');
        
        log('🎉 文件操作测试完成', 'success');
        
    } catch (error) {
        log(`❌ 文件操作测试失败: ${error.message}`, 'error');
    }
}

// 目录操作测试
async function testDirectoryOperations() {
    try {
        log('开始目录操作测试...', 'info');
        
        const root = await navigator.storage.getDirectory();
        const dirName = `test-dir-${++testCounter}`;
        
        // 创建目录
        const dirHandle = await root.getDirectoryHandle(dirName, { create: true });
        log(`✅ 创建目录: ${dirName}`, 'success');
        
        // 在目录中创建文件
        const fileHandle = await dirHandle.getFileHandle('nested-file.txt', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write('嵌套文件内容');
        await writable.close();
        log('✅ 在目录中创建文件', 'success');
        
        // 列出目录内容
        const entries = [];
        for await (const [name, handle] of dirHandle.entries()) {
            entries.push({ name, kind: handle.kind });
        }
        log(`✅ 目录内容: ${entries.map(e => `${e.name}(${e.kind})`).join(', ')}`, 'success');
        
        // 删除目录
        await dirHandle.remove({ recursive: true });
        log('✅ 递归删除目录', 'success');
        
        log('🎉 目录操作测试完成', 'success');
        
    } catch (error) {
        log(`❌ 目录操作测试失败: ${error.message}`, 'error');
    }
}

// SyncAccessHandle 测试
async function testSyncAccessHandle() {
    try {
        log('开始 SyncAccessHandle 测试...', 'info');
        
        const root = await navigator.storage.getDirectory();
        const fileName = `test-sync-${++testCounter}.bin`;
        const fileHandle = await root.getFileHandle(fileName, { create: true });
        
        // 检查 SyncAccessHandle 支持
        if (typeof fileHandle.createSyncAccessHandle !== 'function') {
            log('❌ SyncAccessHandle 不受支持 (需要在 Worker 中使用)', 'error');
            return;
        }
        
        log('⚠️ SyncAccessHandle 只能在 Worker 中使用', 'warning');
        log('请运行 "测试 Worker 同步操作" 来验证 SyncAccessHandle', 'info');
        
    } catch (error) {
        log(`❌ SyncAccessHandle 测试失败: ${error.message}`, 'error');
    }
}

// Worker 中的 OPFS 测试
async function testWorkerOpfs() {
    try {
        log('开始 Worker OPFS 测试...', 'info');
        
        const workerCode = `
            self.onmessage = async (e) => {
                try {
                    const root = await navigator.storage.getDirectory();
                    self.postMessage({ type: 'log', message: '✅ Worker 中获取 OPFS 根目录' });
                    
                    const fileName = 'worker-test-' + Date.now() + '.txt';
                    const fileHandle = await root.getFileHandle(fileName, { create: true });
                    self.postMessage({ type: 'log', message: '✅ Worker 中创建文件句柄' });
                    
                    const writable = await fileHandle.createWritable();
                    await writable.write('Worker 写入的数据');
                    await writable.close();
                    self.postMessage({ type: 'log', message: '✅ Worker 中写入数据' });
                    
                    const file = await fileHandle.getFile();
                    const text = await file.text();
                    self.postMessage({ type: 'log', message: \`✅ Worker 中读取数据: "\${text}"\` });
                    
                    self.postMessage({ type: 'success' });
                } catch (error) {
                    self.postMessage({ type: 'error', message: error.message });
                }
            };
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        
        worker.onmessage = (e) => {
            const { type, message } = e.data;
            if (type === 'log') {
                log(message, 'info');
            } else if (type === 'success') {
                log('🎉 Worker OPFS 测试完成', 'success');
                worker.terminate();
            } else if (type === 'error') {
                log(`❌ Worker OPFS 测试失败: ${message}`, 'error');
                worker.terminate();
            }
        };
        
        worker.onerror = (error) => {
            log(`❌ Worker 错误: ${error.message}`, 'error');
        };
        
        worker.postMessage({ type: 'start' });
        
    } catch (error) {
        log(`❌ Worker OPFS 测试失败: ${error.message}`, 'error');
    }
}

// Worker 同步操作测试
async function testWorkerSync() {
    try {
        log('开始 Worker 同步操作测试...', 'info');

        const workerCode = `
            self.onmessage = async (e) => {
                try {
                    const root = await navigator.storage.getDirectory();
                    const fileName = 'sync-test-' + Date.now() + '.bin';
                    const fileHandle = await root.getFileHandle(fileName, { create: true });

                    if (typeof fileHandle.createSyncAccessHandle === 'function') {
                        const syncHandle = await fileHandle.createSyncAccessHandle();
                        self.postMessage({ type: 'log', message: '✅ 创建 SyncAccessHandle' });

                        // 测试写入
                        const testData = new TextEncoder().encode('SyncAccessHandle 测试数据');
                        const written = syncHandle.write(testData, { at: 0 });
                        self.postMessage({ type: 'log', message: \`✅ 同步写入 \${written} 字节\` });

                        // 测试刷新
                        syncHandle.flush();
                        self.postMessage({ type: 'log', message: '✅ 刷新数据到磁盘' });

                        // 测试读取
                        const size = syncHandle.getSize();
                        const buffer = new Uint8Array(size);
                        const read = syncHandle.read(buffer, { at: 0 });
                        const readText = new TextDecoder().decode(buffer);
                        self.postMessage({ type: 'log', message: \`✅ 同步读取 \${read} 字节: "\${readText}"\` });

                        // 测试截断
                        syncHandle.truncate(10);
                        const newSize = syncHandle.getSize();
                        self.postMessage({ type: 'log', message: \`✅ 截断文件到 \${newSize} 字节\` });

                        // 关闭句柄
                        syncHandle.close();
                        self.postMessage({ type: 'log', message: '✅ 关闭 SyncAccessHandle' });

                        self.postMessage({ type: 'success' });
                    } else {
                        self.postMessage({ type: 'error', message: 'SyncAccessHandle 不可用' });
                    }
                } catch (error) {
                    self.postMessage({ type: 'error', message: error.message });
                }
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = (e) => {
            const { type, message } = e.data;
            if (type === 'log') {
                log(message, 'info');
            } else if (type === 'success') {
                log('🎉 Worker 同步操作测试完成', 'success');
                worker.terminate();
            } else if (type === 'error') {
                log(`❌ Worker 同步操作测试失败: ${message}`, 'error');
                worker.terminate();
            }
        };

        worker.postMessage({ type: 'start' });

    } catch (error) {
        log(`❌ Worker 同步操作测试失败: ${error.message}`, 'error');
    }
}

// 同步读写性能测试
async function testSyncPerformance() {
    try {
        log('开始同步读写性能测试...', 'info');

        const workerCode = `
            self.onmessage = async (e) => {
                try {
                    const root = await navigator.storage.getDirectory();
                    const testData = new Uint8Array(1024 * 10); // 10KB 测试数据
                    for (let i = 0; i < testData.length; i++) {
                        testData[i] = i % 256;
                    }

                    // 测试异步写入性能
                    const asyncStart = performance.now();
                    const asyncFileHandle = await root.getFileHandle('async-perf-test.bin', { create: true });
                    const writable = await asyncFileHandle.createWritable();
                    await writable.write(testData);
                    await writable.close();
                    const asyncTime = performance.now() - asyncStart;
                    self.postMessage({ type: 'log', message: \`异步写入 \${testData.length} 字节耗时: \${asyncTime.toFixed(2)}ms\` });

                    // 测试同步写入性能
                    if (typeof root.getFileHandle('sync-perf-test.bin', { create: true }).then === 'function') {
                        const syncFileHandle = await root.getFileHandle('sync-perf-test.bin', { create: true });
                        if (typeof syncFileHandle.createSyncAccessHandle === 'function') {
                            const syncStart = performance.now();
                            const syncHandle = await syncFileHandle.createSyncAccessHandle();
                            syncHandle.write(testData, { at: 0 });
                            syncHandle.flush();
                            syncHandle.close();
                            const syncTime = performance.now() - syncStart;
                            self.postMessage({ type: 'log', message: \`同步写入 \${testData.length} 字节耗时: \${syncTime.toFixed(2)}ms\` });
                            self.postMessage({ type: 'log', message: \`性能提升: \${((asyncTime - syncTime) / asyncTime * 100).toFixed(1)}%\` });
                        }
                    }

                    self.postMessage({ type: 'success' });
                } catch (error) {
                    self.postMessage({ type: 'error', message: error.message });
                }
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = (e) => {
            const { type, message } = e.data;
            if (type === 'log') {
                log(message, 'info');
            } else if (type === 'success') {
                log('🎉 性能测试完成', 'success');
                worker.terminate();
            } else if (type === 'error') {
                log(`❌ 性能测试失败: ${message}`, 'error');
                worker.terminate();
            }
        };

        worker.postMessage({ type: 'start' });

    } catch (error) {
        log(`❌ 性能测试失败: ${error.message}`, 'error');
    }
}

// 模拟视频块写入测试
async function testVideoChunkWrite() {
    try {
        log('开始模拟视频块写入测试...', 'info');

        const workerCode = `
            self.onmessage = async (e) => {
                try {
                    const root = await navigator.storage.getDirectory();
                    const sessionId = 'video-test-' + Date.now();
                    const recDir = await root.getDirectoryHandle('rec_' + sessionId, { create: true });

                    // 创建数据文件和索引文件
                    const dataFileHandle = await recDir.getFileHandle('data.bin', { create: true });
                    const indexFileHandle = await recDir.getFileHandle('index.jsonl', { create: true });

                    if (typeof dataFileHandle.createSyncAccessHandle === 'function') {
                        const dataSyncHandle = await dataFileHandle.createSyncAccessHandle();
                        const indexWritable = await indexFileHandle.createWritable();

                        let dataOffset = 0;
                        const chunkCount = 50;

                        self.postMessage({ type: 'log', message: \`开始写入 \${chunkCount} 个模拟视频块...\` });

                        const startTime = performance.now();

                        for (let i = 0; i < chunkCount; i++) {
                            // 模拟视频块数据 (随机大小 1KB-10KB)
                            const chunkSize = 1024 + Math.floor(Math.random() * 9216);
                            const chunkData = new Uint8Array(chunkSize);
                            for (let j = 0; j < chunkSize; j++) {
                                chunkData[j] = (i + j) % 256;
                            }

                            // 写入数据
                            const written = dataSyncHandle.write(chunkData, { at: dataOffset });

                            // 写入索引
                            const indexEntry = {
                                offset: dataOffset,
                                size: written,
                                timestamp: Date.now() + i * 33, // 30fps
                                type: i % 10 === 0 ? 'key' : 'delta',
                                isKeyframe: i % 10 === 0
                            };
                            await indexWritable.write(JSON.stringify(indexEntry) + '\\n');

                            dataOffset += written;

                            if (i % 10 === 0) {
                                self.postMessage({ type: 'log', message: \`已写入 \${i + 1}/\${chunkCount} 块\` });
                            }
                        }

                        // 刷新和关闭
                        dataSyncHandle.flush();
                        dataSyncHandle.close();
                        await indexWritable.close();

                        const endTime = performance.now();
                        const totalTime = endTime - startTime;
                        const avgTimePerChunk = totalTime / chunkCount;

                        self.postMessage({ type: 'log', message: \`✅ 写入完成: \${chunkCount} 块, 总大小 \${dataOffset} 字节\` });
                        self.postMessage({ type: 'log', message: \`⏱️ 总耗时: \${totalTime.toFixed(2)}ms, 平均每块: \${avgTimePerChunk.toFixed(2)}ms\` });

                        // 创建元数据文件
                        const metaFileHandle = await recDir.getFileHandle('meta.json', { create: true });
                        const metaWritable = await metaFileHandle.createWritable();
                        const metadata = {
                            id: 'rec_' + sessionId,
                            createdAt: Date.now(),
                            completed: true,
                            codec: 'vp8',
                            width: 1920,
                            height: 1080,
                            fps: 30,
                            totalBytes: dataOffset,
                            totalChunks: chunkCount
                        };
                        await metaWritable.write(JSON.stringify(metadata, null, 2));
                        await metaWritable.close();

                        self.postMessage({ type: 'success' });
                    } else {
                        self.postMessage({ type: 'error', message: 'SyncAccessHandle 不可用' });
                    }
                } catch (error) {
                    self.postMessage({ type: 'error', message: error.message });
                }
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = (e) => {
            const { type, message } = e.data;
            if (type === 'log') {
                log(message, 'info');
            } else if (type === 'success') {
                log('🎉 视频块写入测试完成', 'success');
                worker.terminate();
            } else if (type === 'error') {
                log(`❌ 视频块写入测试失败: ${message}`, 'error');
                worker.terminate();
            }
        };

        worker.postMessage({ type: 'start' });

    } catch (error) {
        log(`❌ 视频块写入测试失败: ${error.message}`, 'error');
    }
}

// 大文件写入测试
async function testLargeFileWrite() {
    try {
        log('开始大文件写入测试...', 'info');

        const root = await navigator.storage.getDirectory();
        const fileName = `large-file-${++testCounter}.bin`;
        const fileHandle = await root.getFileHandle(fileName, { create: true });

        const chunkSize = 1024 * 1024; // 1MB chunks
        const totalChunks = 10; // 10MB total

        log(`准备写入 ${totalChunks}MB 数据 (${totalChunks} 个 1MB 块)...`, 'info');

        const writable = await fileHandle.createWritable();
        const startTime = performance.now();

        for (let i = 0; i < totalChunks; i++) {
            const chunk = new Uint8Array(chunkSize);
            // 填充测试数据
            for (let j = 0; j < chunkSize; j++) {
                chunk[j] = (i * chunkSize + j) % 256;
            }

            await writable.write(chunk);
            log(`已写入块 ${i + 1}/${totalChunks}`, 'info');
        }

        await writable.close();
        const endTime = performance.now();

        // 验证文件大小
        const file = await fileHandle.getFile();
        const expectedSize = chunkSize * totalChunks;
        const actualSize = file.size;

        log(`✅ 写入完成: 预期 ${expectedSize} 字节, 实际 ${actualSize} 字节`,
            actualSize === expectedSize ? 'success' : 'error');
        log(`⏱️ 耗时: ${(endTime - startTime).toFixed(2)}ms`, 'info');
        log(`📊 写入速度: ${(actualSize / 1024 / 1024 / ((endTime - startTime) / 1000)).toFixed(2)} MB/s`, 'info');

        // 清理
        await fileHandle.remove();
        log('🗑️ 已清理测试文件', 'info');

        log('🎉 大文件写入测试完成', 'success');

    } catch (error) {
        log(`❌ 大文件写入测试失败: ${error.message}`, 'error');
    }
}

// 并发写入测试
async function testConcurrentWrites() {
    try {
        log('开始并发写入测试...', 'info');

        const root = await navigator.storage.getDirectory();
        const concurrency = 5;
        const promises = [];

        log(`启动 ${concurrency} 个并发写入任务...`, 'info');

        for (let i = 0; i < concurrency; i++) {
            const promise = (async (index) => {
                const fileName = `concurrent-${index}-${Date.now()}.txt`;
                const fileHandle = await root.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();

                const data = `并发写入任务 ${index} 的数据 - ${new Date().toISOString()}`;
                await writable.write(data);
                await writable.close();

                log(`✅ 任务 ${index} 完成`, 'success');
                return { index, fileName, size: data.length };
            })(i);

            promises.push(promise);
        }

        const startTime = performance.now();
        const results = await Promise.all(promises);
        const endTime = performance.now();

        log(`🎉 所有并发任务完成, 耗时: ${(endTime - startTime).toFixed(2)}ms`, 'success');

        // 验证结果
        for (const result of results) {
            const fileHandle = await root.getFileHandle(result.fileName);
            const file = await fileHandle.getFile();
            log(`验证文件 ${result.fileName}: ${file.size} 字节`, 'info');
            await fileHandle.remove(); // 清理
        }

        log('🗑️ 已清理所有测试文件', 'info');

    } catch (error) {
        log(`❌ 并发写入测试失败: ${error.message}`, 'error');
    }
}

// 列出 OPFS 内容
async function listOpfsContents() {
    try {
        log('列出 OPFS 内容...', 'info');

        const root = await navigator.storage.getDirectory();
        let totalFiles = 0;
        let totalDirs = 0;
        let totalSize = 0;

        for await (const [name, handle] of root.entries()) {
            if (handle.kind === 'file') {
                const file = await handle.getFile();
                totalFiles++;
                totalSize += file.size;
                log(`📄 ${name} (${file.size} 字节)`, 'info');
            } else if (handle.kind === 'directory') {
                totalDirs++;
                log(`📁 ${name}/`, 'info');

                // 列出目录内容
                try {
                    for await (const [subName, subHandle] of handle.entries()) {
                        if (subHandle.kind === 'file') {
                            const subFile = await subHandle.getFile();
                            log(`  📄 ${subName} (${subFile.size} 字节)`, 'info');
                            totalSize += subFile.size;
                        } else {
                            log(`  📁 ${subName}/`, 'info');
                        }
                    }
                } catch (e) {
                    log(`  ❌ 无法读取目录内容: ${e.message}`, 'error');
                }
            }
        }

        log(`📊 统计: ${totalFiles} 个文件, ${totalDirs} 个目录, 总大小 ${totalSize} 字节`, 'success');

    } catch (error) {
        log(`❌ 列出 OPFS 内容失败: ${error.message}`, 'error');
    }
}

// 存储用量估算
async function estimateStorage() {
    try {
        log('估算存储用量...', 'info');

        if (navigator.storage?.estimate) {
            const estimate = await navigator.storage.estimate();
            const usage = estimate.usage || 0;
            const quota = estimate.quota || 0;
            const usagePercent = quota > 0 ? (usage / quota * 100).toFixed(2) : 0;

            log(`💾 已用存储: ${(usage / 1024 / 1024).toFixed(2)} MB`, 'info');
            log(`💾 存储配额: ${(quota / 1024 / 1024).toFixed(2)} MB`, 'info');
            log(`📊 使用率: ${usagePercent}%`, 'info');

            // 检查持久化状态
            if (navigator.storage?.persisted) {
                const persisted = await navigator.storage.persisted();
                log(`🔒 持久化状态: ${persisted ? '已持久化' : '未持久化'}`,
                    persisted ? 'success' : 'warning');
            }
        } else {
            log('❌ 存储估算 API 不可用', 'error');
        }

    } catch (error) {
        log(`❌ 存储用量估算失败: ${error.message}`, 'error');
    }
}

// 清空 OPFS
async function clearOpfs() {
    try {
        if (!confirm('确定要清空整个 OPFS 吗？这将删除所有数据！')) {
            return;
        }

        log('开始清空 OPFS...', 'warning');

        const root = await navigator.storage.getDirectory();
        await root.remove({ recursive: true });

        log('🗑️ OPFS 已清空', 'success');

    } catch (error) {
        log(`❌ 清空 OPFS 失败: ${error.message}`, 'error');
    }
}

// 测试修复后的 OPFS Writer
async function testFixedOpfsWriter() {
    try {
        log('开始测试修复后的 OPFS Writer...', 'info');

        const worker = new Worker('./test-worker.js');

        worker.onmessage = (ev) => {
            const { type, id, message } = ev.data || {};

            if (type === 'ready') {
                log(`✅ Writer 就绪: ${id}`, 'success');

                // 发送测试数据
                const testData1 = new TextEncoder().encode('第一个测试数据块 - 关键帧');
                worker.postMessage({
                    type: 'append',
                    buffer: testData1.buffer,
                    timestamp: Date.now(),
                    chunkType: 'key',
                    codedWidth: 1920,
                    codedHeight: 1080,
                    codec: 'vp8',
                    isKeyframe: true
                }, [testData1.buffer]);

                setTimeout(() => {
                    const testData2 = new TextEncoder().encode('第二个测试数据块 - 增量帧');
                    worker.postMessage({
                        type: 'append',
                        buffer: testData2.buffer,
                        timestamp: Date.now() + 33,
                        chunkType: 'delta',
                        codedWidth: 1920,
                        codedHeight: 1080,
                        codec: 'vp8',
                        isKeyframe: false
                    }, [testData2.buffer]);

                    setTimeout(() => {
                        worker.postMessage({ type: 'finalize' });
                    }, 100);
                }, 100);

            } else if (type === 'progress') {
                const { bytesWrittenTotal, chunksWritten } = ev.data;
                log(`📊 进度: ${chunksWritten} 块, ${bytesWrittenTotal} 字节`, 'info');

            } else if (type === 'finalized') {
                log(`✅ Writer 完成: ${id}`, 'success');
                worker.terminate();

                // 验证结果
                setTimeout(async () => {
                    try {
                        const root = await navigator.storage.getDirectory();
                        const recDir = await root.getDirectoryHandle(`rec_${id}`);

                        const dataFile = await recDir.getFileHandle('data.bin');
                        const dataFileObj = await dataFile.getFile();
                        log(`✅ 验证 data.bin: ${dataFileObj.size} 字节`,
                            dataFileObj.size > 0 ? 'success' : 'error');

                        const indexFile = await recDir.getFileHandle('index.jsonl');
                        const indexFileObj = await indexFile.getFile();
                        const indexText = await indexFileObj.text();
                        const lines = indexText.trim().split('\n').filter(l => l);
                        log(`✅ 验证 index.jsonl: ${lines.length} 条记录`, 'success');

                        const metaFile = await recDir.getFileHandle('meta.json');
                        const metaFileObj = await metaFile.getFile();
                        const metaText = await metaFileObj.text();
                        const meta = JSON.parse(metaText);
                        log(`✅ 验证 meta.json: ${meta.completed ? '已完成' : '未完成'}`,
                            meta.completed ? 'success' : 'error');

                        log('🎉 修复后的 OPFS Writer 测试完成！', 'success');

                    } catch (e) {
                        log(`❌ 验证失败: ${e.message}`, 'error');
                    }
                }, 500);

            } else if (type === 'error') {
                log(`❌ Writer 错误: ${message}`, 'error');
                worker.terminate();
            }
        };

        worker.onerror = (error) => {
            log(`❌ Worker 错误: ${error.message}`, 'error');
        };

        // 初始化 Writer
        const sessionId = `fixed_test_${Date.now()}`;
        worker.postMessage({
            type: 'init',
            id: sessionId,
            meta: {
                codec: 'vp8',
                width: 1920,
                height: 1080,
                fps: 30
            }
        });

    } catch (error) {
        log(`❌ 测试修复后的 OPFS Writer 失败: ${error.message}`, 'error');
    }
}

// 测试 Worker 基础功能
async function testWorkerBasics() {
    try {
        log('开始测试 Worker 基础功能...', 'info');

        const worker = new Worker('./test-worker.js');

        worker.onmessage = (e) => {
            const { type, message } = e.data;
            if (type === 'log') {
                log(message, 'info');
            } else if (type === 'test-complete') {
                log('🎉 Worker 基础测试完成', 'success');
                worker.terminate();
            } else if (type === 'error') {
                log(`❌ Worker 基础测试失败: ${message}`, 'error');
                worker.terminate();
            }
        };

        worker.postMessage({ type: 'test-basic' });

    } catch (error) {
        log(`❌ Worker 基础测试失败: ${error.message}`, 'error');
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    checkOpfsSupport();
    log('OPFS API 测试页面已加载', 'info');
    log('请点击上方按钮开始测试各项功能', 'info');
});

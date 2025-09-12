// 测试 Worker - 验证修复后的 OPFS Writer 功能

// 复制修复后的 OPFS Writer 逻辑
let rootDir = null;
let recDir = null;
let dataHandle = null;
let dataSyncHandle = null;
let dataOffset = 0;
let pendingIndexLines = [];
let chunksWritten = 0;
let recordingId = '';
let initialMeta = {};
let fallbackDataParts = [];

async function ensureRoot() {
    if (!self.navigator?.storage?.getDirectory) throw new Error('OPFS not available in this context');
    rootDir = await self.navigator.storage.getDirectory();
}

async function ensureRecDir(id) {
    if (!rootDir) await ensureRoot();
    recDir = await rootDir.getDirectoryHandle(`rec_${id}`, { create: true });
}

async function writeMeta(partial) {
    if (!recDir) return;
    const fh = await recDir.getFileHandle('meta.json', { create: true });
    const writable = await fh.createWritable({ keepExistingData: false });
    const blob = new Blob([JSON.stringify(partial, null, 2)], { type: 'application/json' });
    await writable.write(blob);
    await writable.close();
}

async function appendIndexLine(line) {
    pendingIndexLines.push(line);
}

async function flushIndexToFile() {
    if (!recDir || pendingIndexLines.length === 0) return;
    const text = pendingIndexLines.join('');
    const fh = await recDir.getFileHandle('index.jsonl', { create: true });
    const writable = await fh.createWritable({ keepExistingData: false });
    await writable.write(new Blob([text], { type: 'text/plain' }));
    await writable.close();
}

async function openDataFile() {
    if (!recDir) throw new Error('recDir not ready');
    dataHandle = await recDir.getFileHandle('data.bin', { create: true });
    const hasSync = typeof dataHandle.createSyncAccessHandle === 'function';
    if (hasSync) {
        dataSyncHandle = await dataHandle.createSyncAccessHandle();
        dataOffset = 0;
    } else {
        dataSyncHandle = null;
        dataOffset = 0;
        fallbackDataParts = [];
    }
}

async function appendData(u8) {
    if (dataSyncHandle) {
        // 修复：直接传递 Uint8Array，write() 是同步方法
        const written = dataSyncHandle.write(u8, { at: dataOffset });
        dataOffset += (typeof written === 'number' ? written : u8.byteLength);
    } else {
        fallbackDataParts.push(u8);
        dataOffset += u8.byteLength;
    }
}

async function flushDataFallback() {
    if (!dataHandle || fallbackDataParts.length === 0) return;
    const writable = await dataHandle.createWritable({ keepExistingData: false });
    for (const part of fallbackDataParts) {
        await writable.write(part);
    }
    await writable.close();
    fallbackDataParts = [];
}

async function closeData() {
    if (dataSyncHandle) {
        // 修复：flush() 和 close() 是同步方法
        try { dataSyncHandle.flush(); } catch {}
        try { dataSyncHandle.close(); } catch {}
        dataSyncHandle = null;
    } else {
        await flushDataFallback();
    }
}

self.onmessage = async (e) => {
    const msg = e.data;
    try {
        if (msg.type === 'init') {
            recordingId = msg.id;
            initialMeta = {
                id: `rec_${msg.id}`,
                createdAt: Date.now(),
                completed: false,
                codec: msg.meta?.codec,
                width: msg.meta?.width,
                height: msg.meta?.height,
                fps: msg.meta?.fps
            };
            await ensureRoot();
            await ensureRecDir(msg.id);
            await openDataFile();
            await writeMeta(initialMeta);
            self.postMessage({ type: 'ready', id: msg.id });
            return;
        }

        if (msg.type === 'append') {
            if (!dataHandle) throw new Error('writer not initialized');
            const u8 = new Uint8Array(msg.buffer);
            await appendData(u8);
            await appendIndexLine(JSON.stringify({
                offset: dataOffset - u8.byteLength,
                size: u8.byteLength,
                timestamp: msg.timestamp ?? 0,
                type: msg.chunkType === 'key' ? 'key' : 'delta',
                codedWidth: msg.codedWidth,
                codedHeight: msg.codedHeight,
                codec: msg.codec,
                isKeyframe: !!msg.isKeyframe
            }) + '\n');
            chunksWritten++;
            if (chunksWritten % 10 === 0) {
                self.postMessage({ type: 'progress', bytesWrittenTotal: dataOffset, chunksWritten });
                try { await flushIndexToFile(); } catch {}
            }
            return;
        }

        if (msg.type === 'flush') {
            // 修复：flush() 是同步方法
            try { dataSyncHandle?.flush(); } catch {}
            try { await flushIndexToFile(); } catch {}
            self.postMessage({ type: 'progress', bytesWrittenTotal: dataOffset, chunksWritten });
            return;
        }

        if (msg.type === 'finalize') {
            await flushIndexToFile();
            await closeData();
            await writeMeta({ ...initialMeta, completed: true, totalBytes: dataOffset, totalChunks: chunksWritten });
            self.postMessage({ type: 'finalized', id: recordingId });
            return;
        }

        // 测试命令
        if (msg.type === 'test-basic') {
            self.postMessage({ type: 'log', message: '开始基础 OPFS 测试...' });
            
            const root = await self.navigator.storage.getDirectory();
            self.postMessage({ type: 'log', message: '✅ 获取 OPFS 根目录' });
            
            const testFile = await root.getFileHandle('worker-basic-test.txt', { create: true });
            const writable = await testFile.createWritable();
            await writable.write('Worker 基础测试数据');
            await writable.close();
            self.postMessage({ type: 'log', message: '✅ 写入测试文件' });
            
            const file = await testFile.getFile();
            const text = await file.text();
            self.postMessage({ type: 'log', message: `✅ 读取数据: "${text}"` });
            
            self.postMessage({ type: 'test-complete' });
            return;
        }

        if (msg.type === 'test-sync') {
            self.postMessage({ type: 'log', message: '开始 SyncAccessHandle 测试...' });
            
            const root = await self.navigator.storage.getDirectory();
            const testFile = await root.getFileHandle('worker-sync-test.bin', { create: true });
            
            if (typeof testFile.createSyncAccessHandle === 'function') {
                const syncHandle = await testFile.createSyncAccessHandle();
                self.postMessage({ type: 'log', message: '✅ 创建 SyncAccessHandle' });
                
                const testData = new TextEncoder().encode('SyncAccessHandle 测试数据');
                const written = syncHandle.write(testData, { at: 0 });
                self.postMessage({ type: 'log', message: `✅ 写入 ${written} 字节` });
                
                syncHandle.flush();
                self.postMessage({ type: 'log', message: '✅ 刷新数据' });
                
                const size = syncHandle.getSize();
                const buffer = new Uint8Array(size);
                const read = syncHandle.read(buffer, { at: 0 });
                const readText = new TextDecoder().decode(buffer);
                self.postMessage({ type: 'log', message: `✅ 读取 ${read} 字节: "${readText}"` });
                
                syncHandle.close();
                self.postMessage({ type: 'log', message: '✅ 关闭句柄' });
                
                self.postMessage({ type: 'test-complete' });
            } else {
                self.postMessage({ type: 'error', message: 'SyncAccessHandle 不可用' });
            }
            return;
        }

    } catch (err) {
        const ev = { type: 'error', code: 'OPFS_WRITE_ERROR', message: err?.message || String(err) };
        try { self.postMessage(ev); } catch {}
    }
};

self.addEventListener('error', (ev) => {
    const msg = { type: 'error', code: 'WORKER_ERROR', message: ev?.message || 'Unknown worker error' };
    try { self.postMessage(msg); } catch {}
});

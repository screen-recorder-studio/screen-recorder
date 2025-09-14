<script lang="ts">
  import { onMount } from 'svelte'

  type ChunkIndex = {
    offset: number
    size: number
    timestamp: number // microseconds
    type: 'key' | 'delta'
    isKeyframe?: boolean
    codedWidth?: number
    codedHeight?: number
    codec?: string
  }

  type MetaData = {
    id: string
    codec: string
    width: number
    height: number
    fps: number
    totalChunks: number
    decoderConfig?: any
  }

  type AnalysisResult = {
    meta: MetaData
    indexEntries: ChunkIndex[]
    dataSize: number
    keyframeAnalysis: {
      count: number
      indices: number[]
      intervals: number[]
      avgInterval: number
    }
    timestampAnalysis: {
      firstTimestamp: number
      lastTimestamp: number
      durationMs: number
      avgFrameInterval: number
      timestampGaps: number[]
    }
    sizeAnalysis: {
      totalSize: number
      avgChunkSize: number
      minChunkSize: number
      maxChunkSize: number
      keyframeSizes: number[]
      deltaframeSizes: number[]
    }
    offsetAnalysis: {
      isMonotonic: boolean
      gaps: number[]
      overlaps: number[]
    }
  }

  const defaultId = 'rec_1757651534329'
  let recordingId = defaultId
  let running = false
  let analysis: AnalysisResult | null = null
  let messages: string[] = []
  let dirList: string[] = []
  let selectedSample: ChunkIndex | null = null
  let sampleData: ArrayBuffer | null = null

  function log(msg: string) { 
    messages = [...messages, `[${new Date().toLocaleTimeString()}] ${msg}`] 
  }

  function reset() {
    analysis = null
    messages = []
    selectedSample = null
    sampleData = null
  }

  async function scanOPFS() {
    try {
      if (!('storage' in navigator) || !(navigator as any).storage.getDirectory) {
        log('OPFS not available in this origin/context')
        return
      }
      const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory()
      const found: string[] = []
      // @ts-ignore for await on directory entries in OPFS
      for await (const [name, handle] of (root as any).entries?.() ?? []) {
        if ((handle as any)?.kind === 'directory' && String(name).startsWith('rec_')) {
          found.push(String(name))
        }
      }
      dirList = found.sort()
      log(`Found ${dirList.length} rec_* directories`)
    } catch (e: any) {
      log(`Scan error: ${e?.message ?? String(e)}`)
    }
  }

  async function analyzeData() {
    reset()
    running = true
    
    try {
      log('Starting comprehensive data analysis...')
      
      if (!('storage' in navigator) || !(navigator as any).storage.getDirectory) {
        throw new Error('OPFS not available in this origin/context')
      }
      
      const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory()
      const dir = await root.getDirectoryHandle(recordingId, { create: false })
      log(`Opened directory: ${recordingId}`)

      // Read all files
      const metaHandle = await dir.getFileHandle('meta.json')
      const indexHandle = await dir.getFileHandle('index.jsonl')
      const dataHandle = await dir.getFileHandle('data.bin')

      log('Reading meta.json...')
      const metaText = await (await metaHandle.getFile()).text()
      const meta: MetaData = JSON.parse(metaText)
      
      log('Reading data.bin info...')
      const dataFile = await dataHandle.getFile()
      const dataSize = dataFile.size
      
      log('Reading and parsing index.jsonl...')
      const indexText = await (await indexHandle.getFile()).text()
      const lines = indexText.split(/\r?\n/).filter(Boolean)
      const indexEntries: ChunkIndex[] = lines.map((l, i) => {
        try { 
          return JSON.parse(l) 
        } catch { 
          throw new Error(`Bad JSON at index line ${i}: ${l.substring(0, 100)}...`) 
        }
      })

      log(`Parsed ${indexEntries.length} index entries`)

      // Analyze keyframes
      log('Analyzing keyframes...')
      const keyframeIndices: number[] = []
      indexEntries.forEach((entry, i) => {
        if (entry.type === 'key' || entry.isKeyframe) {
          keyframeIndices.push(i)
        }
      })
      
      const keyframeIntervals = keyframeIndices.slice(1).map((idx, i) => idx - keyframeIndices[i])
      const avgKeyframeInterval = keyframeIntervals.length > 0 
        ? keyframeIntervals.reduce((a, b) => a + b, 0) / keyframeIntervals.length 
        : 0

      // Analyze timestamps
      log('Analyzing timestamps...')
      const firstTimestamp = indexEntries[0]?.timestamp ?? 0
      const lastTimestamp = indexEntries[indexEntries.length - 1]?.timestamp ?? 0
      const durationMs = Math.round((lastTimestamp - firstTimestamp) / 1000)
      
      const timestampGaps: number[] = []
      for (let i = 1; i < indexEntries.length; i++) {
        const gap = indexEntries[i].timestamp - indexEntries[i - 1].timestamp
        timestampGaps.push(gap)
      }
      const avgFrameInterval = timestampGaps.length > 0 
        ? timestampGaps.reduce((a, b) => a + b, 0) / timestampGaps.length 
        : 0

      // Analyze chunk sizes
      log('Analyzing chunk sizes...')
      const chunkSizes = indexEntries.map(e => e.size)
      const keyframeSizes = indexEntries.filter(e => e.type === 'key' || e.isKeyframe).map(e => e.size)
      const deltaframeSizes = indexEntries.filter(e => e.type === 'delta' && !e.isKeyframe).map(e => e.size)
      
      const totalSize = chunkSizes.reduce((a, b) => a + b, 0)
      const avgChunkSize = totalSize / chunkSizes.length
      const minChunkSize = Math.min(...chunkSizes)
      const maxChunkSize = Math.max(...chunkSizes)

      // Analyze offsets
      log('Analyzing offsets...')
      let isMonotonic = true
      const gaps: number[] = []
      const overlaps: number[] = []
      
      for (let i = 1; i < indexEntries.length; i++) {
        const prevEnd = indexEntries[i - 1].offset + indexEntries[i - 1].size
        const currentStart = indexEntries[i].offset
        
        if (currentStart < prevEnd) {
          isMonotonic = false
          overlaps.push(prevEnd - currentStart)
        } else if (currentStart > prevEnd) {
          gaps.push(currentStart - prevEnd)
        }
      }

      analysis = {
        meta,
        indexEntries,
        dataSize,
        keyframeAnalysis: {
          count: keyframeIndices.length,
          indices: keyframeIndices,
          intervals: keyframeIntervals,
          avgInterval: avgKeyframeInterval
        },
        timestampAnalysis: {
          firstTimestamp,
          lastTimestamp,
          durationMs,
          avgFrameInterval,
          timestampGaps
        },
        sizeAnalysis: {
          totalSize,
          avgChunkSize,
          minChunkSize,
          maxChunkSize,
          keyframeSizes,
          deltaframeSizes
        },
        offsetAnalysis: {
          isMonotonic,
          gaps,
          overlaps
        }
      }

      log('Analysis completed successfully!')
      
    } catch (e: any) {
      console.error(e)
      log(`Error: ${e?.message || String(e)}`)
    } finally {
      running = false
    }
  }

  async function loadSampleChunk(entry: ChunkIndex) {
    try {
      log(`Loading sample chunk at offset ${entry.offset}, size ${entry.size}`)
      
      const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory()
      const dir = await root.getDirectoryHandle(recordingId, { create: false })
      const dataHandle = await dir.getFileHandle('data.bin')
      const dataFile = await dataHandle.getFile()
      
      const blob = dataFile.slice(entry.offset, entry.offset + entry.size)
      sampleData = await blob.arrayBuffer()
      selectedSample = entry
      
      log(`Loaded ${sampleData.byteLength} bytes of sample data`)
    } catch (e: any) {
      log(`Error loading sample: ${e?.message || String(e)}`)
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  function formatTimestamp(timestamp: number): string {
    const ms = Math.round(timestamp / 1000)
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`
    } else if (minutes > 0) {
      return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`
    } else {
      return `${seconds}.${(ms % 1000).toString().padStart(3, '0')}s`
    }
  }

  onMount(() => {
    scanOPFS()
  })
</script>

<section class="wrap">
  <h1>📊 OPFS Data Analyzer</h1>
  <p>Deep analysis of index.jsonl, meta.json, and data.bin files</p>
  
  <div class="controls">
    <label for="rec-id">Recording ID:</label>
    <input id="rec-id" bind:value={recordingId} placeholder="rec_..." />
    <button on:click={analyzeData} disabled={running}>🔍 Analyze Data</button>
    <button on:click={scanOPFS} disabled={running}>📁 Scan OPFS</button>
  </div>

  {#if running}
    <div class="loading">
      <p>🔄 Running comprehensive analysis...</p>
    </div>
  {/if}

  {#if dirList.length}
    <div class="dirs">
      <h3>📂 Available Recordings</h3>
      <div class="dir-list">
        {#each dirList as d}
          <button class="dir-btn" class:active={d === recordingId} on:click={() => recordingId = d}>
            {d}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if analysis}
    <div class="analysis-results">
      <!-- Meta Data Analysis -->
      <div class="section">
        <h3>📄 Meta Data (meta.json)</h3>
        <div class="grid">
          <div class="card">
            <h4>Basic Info</h4>
            <ul>
              <li><strong>ID:</strong> {analysis.meta.id}</li>
              <li><strong>Codec:</strong> {analysis.meta.codec}</li>
              <li><strong>Resolution:</strong> {analysis.meta.width}×{analysis.meta.height}</li>
              <li><strong>FPS:</strong> {analysis.meta.fps}</li>
              <li><strong>Total Chunks:</strong> {analysis.meta.totalChunks}</li>
            </ul>
          </div>
          <div class="card">
            <h4>File Sizes</h4>
            <ul>
              <li><strong>Data.bin:</strong> {formatBytes(analysis.dataSize)}</li>
              <li><strong>Index entries:</strong> {analysis.indexEntries.length}</li>
              <li><strong>Calculated size:</strong> {formatBytes(analysis.sizeAnalysis.totalSize)}</li>
              <li><strong>Match:</strong> {analysis.dataSize === analysis.sizeAnalysis.totalSize ? '✅' : '❌'}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Keyframe Analysis -->
      <div class="section">
        <h3>🔑 Keyframe Analysis</h3>
        <div class="grid">
          <div class="card">
            <h4>Statistics</h4>
            <ul>
              <li><strong>Total keyframes:</strong> {analysis.keyframeAnalysis.count}</li>
              <li><strong>Keyframe ratio:</strong> {((analysis.keyframeAnalysis.count / analysis.indexEntries.length) * 100).toFixed(1)}%</li>
              <li><strong>Avg interval:</strong> {analysis.keyframeAnalysis.avgInterval.toFixed(1)} frames</li>
              <li><strong>Expected interval:</strong> {analysis.meta.fps} frames (1 sec)</li>
            </ul>
          </div>
          <div class="card">
            <h4>Size Comparison</h4>
            <ul>
              <li><strong>Avg keyframe size:</strong> {formatBytes(analysis.sizeAnalysis.keyframeSizes.reduce((a, b) => a + b, 0) / analysis.sizeAnalysis.keyframeSizes.length)}</li>
              <li><strong>Avg delta size:</strong> {formatBytes(analysis.sizeAnalysis.deltaframeSizes.reduce((a, b) => a + b, 0) / analysis.sizeAnalysis.deltaframeSizes.length)}</li>
              <li><strong>Size ratio:</strong> {((analysis.sizeAnalysis.keyframeSizes.reduce((a, b) => a + b, 0) / analysis.sizeAnalysis.keyframeSizes.length) / (analysis.sizeAnalysis.deltaframeSizes.reduce((a, b) => a + b, 0) / analysis.sizeAnalysis.deltaframeSizes.length)).toFixed(1)}x</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Timestamp Analysis -->
      <div class="section">
        <h3>⏱️ Timestamp Analysis</h3>
        <div class="grid">
          <div class="card">
            <h4>Duration</h4>
            <ul>
              <li><strong>First timestamp:</strong> {analysis.timestampAnalysis.firstTimestamp.toLocaleString()} μs</li>
              <li><strong>Last timestamp:</strong> {analysis.timestampAnalysis.lastTimestamp.toLocaleString()} μs</li>
              <li><strong>Duration:</strong> {formatTimestamp(analysis.timestampAnalysis.lastTimestamp - analysis.timestampAnalysis.firstTimestamp)}</li>
              <li><strong>Duration (ms):</strong> {analysis.timestampAnalysis.durationMs.toLocaleString()} ms</li>
            </ul>
          </div>
          <div class="card">
            <h4>Frame Timing</h4>
            <ul>
              <li><strong>Avg frame interval:</strong> {(analysis.timestampAnalysis.avgFrameInterval / 1000).toFixed(2)} ms</li>
              <li><strong>Expected interval:</strong> {(1000 / analysis.meta.fps).toFixed(2)} ms</li>
              <li><strong>Calculated FPS:</strong> {(1000000 / analysis.timestampAnalysis.avgFrameInterval).toFixed(1)}</li>
              <li><strong>Timing accuracy:</strong> {Math.abs(1000000 / analysis.timestampAnalysis.avgFrameInterval - analysis.meta.fps) < 1 ? '✅' : '⚠️'}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Chunk Size Analysis -->
      <div class="section">
        <h3>📦 Chunk Size Analysis</h3>
        <div class="grid">
          <div class="card">
            <h4>Size Statistics</h4>
            <ul>
              <li><strong>Total size:</strong> {formatBytes(analysis.sizeAnalysis.totalSize)}</li>
              <li><strong>Average size:</strong> {formatBytes(analysis.sizeAnalysis.avgChunkSize)}</li>
              <li><strong>Min size:</strong> {formatBytes(analysis.sizeAnalysis.minChunkSize)}</li>
              <li><strong>Max size:</strong> {formatBytes(analysis.sizeAnalysis.maxChunkSize)}</li>
              <li><strong>Size range:</strong> {(analysis.sizeAnalysis.maxChunkSize / analysis.sizeAnalysis.minChunkSize).toFixed(1)}x</li>
            </ul>
          </div>
          <div class="card">
            <h4>Distribution</h4>
            <ul>
              <li><strong>Keyframes:</strong> {analysis.sizeAnalysis.keyframeSizes.length} chunks</li>
              <li><strong>Delta frames:</strong> {analysis.sizeAnalysis.deltaframeSizes.length} chunks</li>
              <li><strong>Keyframe data:</strong> {formatBytes(analysis.sizeAnalysis.keyframeSizes.reduce((a, b) => a + b, 0))} ({((analysis.sizeAnalysis.keyframeSizes.reduce((a, b) => a + b, 0) / analysis.sizeAnalysis.totalSize) * 100).toFixed(1)}%)</li>
              <li><strong>Delta data:</strong> {formatBytes(analysis.sizeAnalysis.deltaframeSizes.reduce((a, b) => a + b, 0))} ({((analysis.sizeAnalysis.deltaframeSizes.reduce((a, b) => a + b, 0) / analysis.sizeAnalysis.totalSize) * 100).toFixed(1)}%)</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Offset Analysis -->
      <div class="section">
        <h3>📍 Offset Analysis (data.bin structure)</h3>
        <div class="grid">
          <div class="card">
            <h4>Integrity</h4>
            <ul>
              <li><strong>Monotonic offsets:</strong> {analysis.offsetAnalysis.isMonotonic ? '✅ Yes' : '❌ No'}</li>
              <li><strong>Gaps found:</strong> {analysis.offsetAnalysis.gaps.length}</li>
              <li><strong>Overlaps found:</strong> {analysis.offsetAnalysis.overlaps.length}</li>
              {#if analysis.offsetAnalysis.gaps.length > 0}
                <li><strong>Total gap size:</strong> {formatBytes(analysis.offsetAnalysis.gaps.reduce((a, b) => a + b, 0))}</li>
              {/if}
            </ul>
          </div>
          <div class="card">
            <h4>Data Efficiency</h4>
            <ul>
              <li><strong>Used space:</strong> {formatBytes(analysis.sizeAnalysis.totalSize)}</li>
              <li><strong>File size:</strong> {formatBytes(analysis.dataSize)}</li>
              <li><strong>Efficiency:</strong> {((analysis.sizeAnalysis.totalSize / analysis.dataSize) * 100).toFixed(1)}%</li>
              <li><strong>Wasted space:</strong> {formatBytes(analysis.dataSize - analysis.sizeAnalysis.totalSize)}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Sample Data Viewer -->
      <div class="section">
        <h3>🔍 Sample Data Viewer</h3>
        <div class="sample-viewer">
          <div class="sample-controls">
            <label for="chunk-selector">Select chunk to examine:</label>
            <select id="chunk-selector" on:change={(e) => {
              const target = e.target as HTMLSelectElement
              const idx = parseInt(target.value, 10)
              if (!isNaN(idx) && analysis) {
                loadSampleChunk(analysis.indexEntries[idx])
              }
            }}>
              <option value="">Choose a chunk...</option>
              {#each analysis.indexEntries.slice(0, 50) as entry, i}
                <option value={i}>
                  #{i} - {entry.type} - {formatBytes(entry.size)} - {formatTimestamp(entry.timestamp)}
                </option>
              {/each}
              {#if analysis.indexEntries.length > 50}
                <option disabled>... and {analysis.indexEntries.length - 50} more</option>
              {/if}
            </select>
          </div>

          {#if selectedSample && sampleData}
            <div class="sample-details">
              <h4>Chunk Details</h4>
              <div class="grid">
                <div class="card">
                  <h5>Metadata</h5>
                  <ul>
                    <li><strong>Type:</strong> {selectedSample.type}</li>
                    <li><strong>Offset:</strong> {selectedSample.offset.toLocaleString()}</li>
                    <li><strong>Size:</strong> {formatBytes(selectedSample.size)}</li>
                    <li><strong>Timestamp:</strong> {selectedSample.timestamp.toLocaleString()} μs</li>
                    {#if selectedSample.codedWidth}<li><strong>Coded Size:</strong> {selectedSample.codedWidth}×{selectedSample.codedHeight}</li>{/if}
                    {#if selectedSample.codec}<li><strong>Codec:</strong> {selectedSample.codec}</li>{/if}
                  </ul>
                </div>
                <div class="card">
                  <h5>Binary Data (first 64 bytes)</h5>
                  <div class="hex-dump">
                    {#each Array.from(new Uint8Array(sampleData.slice(0, 64))) as byte, i}
                      <span class="hex-byte" class:printable={byte >= 32 && byte <= 126}>
                        {byte.toString(16).padStart(2, '0')}
                      </span>
                      {#if (i + 1) % 16 === 0}<br>{/if}
                    {/each}
                    {#if sampleData.byteLength > 64}
                      <div class="truncated">... ({sampleData.byteLength - 64} more bytes)</div>
                    {/if}
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Index.jsonl Structure Analysis -->
      <div class="section">
        <h3>📋 Index.jsonl Structure</h3>
        <div class="card">
          <h4>Field Usage Analysis</h4>
          <div class="field-analysis">
            {#each Object.keys(analysis.indexEntries[0] || {}) as field}
              {@const hasField = analysis.indexEntries.filter(e => e[field] !== undefined).length}
              {@const coverage = (hasField / analysis.indexEntries.length) * 100}
              <div class="field-row">
                <span class="field-name">{field}:</span>
                <span class="field-coverage" class:full={coverage === 100} class:partial={coverage > 0 && coverage < 100} class:missing={coverage === 0}>
                  {hasField}/{analysis.indexEntries.length} ({coverage.toFixed(1)}%)
                </span>
                {#if field === 'timestamp'}
                  <span class="field-note">Range: {analysis.timestampAnalysis.firstTimestamp.toLocaleString()} - {analysis.timestampAnalysis.lastTimestamp.toLocaleString()} μs</span>
                {:else if field === 'size'}
                  <span class="field-note">Range: {formatBytes(analysis.sizeAnalysis.minChunkSize)} - {formatBytes(analysis.sizeAnalysis.maxChunkSize)}</span>
                {:else if field === 'type'}
                  <span class="field-note">key: {analysis.keyframeAnalysis.count}, delta: {analysis.indexEntries.length - analysis.keyframeAnalysis.count}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Messages Log -->
  {#if messages.length}
    <div class="section">
      <h3>📝 Analysis Log</h3>
      <div class="logs">
        <pre>{messages.join('\n')}</pre>
      </div>
    </div>
  {/if}
</section>

<style>
  .wrap { 
    padding: 20px; 
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .controls { 
    display: flex; 
    gap: 12px; 
    align-items: center; 
    margin-bottom: 20px;
    padding: 16px;
    background: #f8f9fa;
    border-radius: 8px;
  }
  
  input { 
    width: 300px; 
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  
  button { 
    padding: 8px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  button:hover { 
    background: #f0f0f0; 
  }
  
  button:disabled { 
    opacity: 0.6; 
    cursor: not-allowed; 
  }
  
  .loading {
    text-align: center;
    padding: 40px;
    background: #e3f2fd;
    border-radius: 8px;
    margin: 20px 0;
  }
  
  .dirs {
    margin: 20px 0;
    padding: 16px;
    background: #f8f9fa;
    border-radius: 8px;
  }
  
  .dir-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  
  .dir-btn {
    padding: 6px 12px;
    font-size: 12px;
    border-radius: 16px;
  }
  
  .dir-btn.active {
    background: #007bff;
    color: white;
    border-color: #007bff;
  }

  .analysis-results {
    margin-top: 20px;
  }

  .section {
    margin-bottom: 30px;
    padding: 20px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .section h3 {
    margin: 0 0 16px 0;
    color: #333;
    border-bottom: 2px solid #007bff;
    padding-bottom: 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }

  .card {
    padding: 16px;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid #e9ecef;
  }

  .card h4, .card h5 {
    margin: 0 0 12px 0;
    color: #495057;
  }

  .card ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .card li {
    padding: 4px 0;
    border-bottom: 1px solid #e9ecef;
  }

  .card li:last-child {
    border-bottom: none;
  }

  .sample-viewer {
    background: #f8f9fa;
    padding: 16px;
    border-radius: 6px;
  }

  .sample-controls {
    margin-bottom: 16px;
  }

  .sample-controls label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
  }

  .sample-controls select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
  }

  .sample-details {
    margin-top: 16px;
  }

  .hex-dump {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.4;
    background: #000;
    color: #0f0;
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
  }

  .hex-byte {
    margin-right: 4px;
  }

  .hex-byte.printable {
    color: #ff0;
  }

  .truncated {
    color: #888;
    font-style: italic;
    margin-top: 8px;
  }

  .field-analysis {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    background: #f8f9fa;
    border-radius: 4px;
  }

  .field-name {
    font-weight: 500;
    min-width: 100px;
  }

  .field-coverage {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .field-coverage.full {
    background: #d4edda;
    color: #155724;
  }

  .field-coverage.partial {
    background: #fff3cd;
    color: #856404;
  }

  .field-coverage.missing {
    background: #f8d7da;
    color: #721c24;
  }

  .field-note {
    font-size: 12px;
    color: #6c757d;
    font-style: italic;
  }

  .logs {
    background: #000;
    color: #0f0;
    padding: 16px;
    border-radius: 6px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    max-height: 300px;
    overflow-y: auto;
  }

  .logs pre {
    margin: 0;
    white-space: pre-wrap;
  }
</style>

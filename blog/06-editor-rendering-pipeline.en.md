# Web Video Editing Engine (3): Offscreen Rendering Pipeline and Real‑Time Compositing

In front‑end land, manipulating a lot of DOM is “heavy lifting.”  
Real‑time video compositing is more like **microsurgery**.

In [the previous article](./05-editor-seeking-gop-alignment.en.md), we solved the problem of **finding** the right bytes: frame‑accurate seeking on top of OPFS and GOP alignment.

Now we face a new challenge:

> How do we turn those dry encoded chunks into 60fps video, with background blur, rounded corners, shadows, and zoom animations – all inside the browser – without freezing the UI?

Picture this: the user is scrubbing the timeline, previewing a 4K recording. On top of the raw video, they’ve enabled:

- A blurred background,
- Rounded corners and drop shadows,
- A zoom‑in animation around a specific region of the screen.

If we try to do all of that on the main thread, the result is inevitable:

- Playback stutters,
- Buttons feel unresponsive,
- The entire UI “sticks.”

Today we’ll look at the visual nervous system of Screen Recorder Studio: the **rendering pipeline** built on top of `OffscreenCanvas` and Workers.

> 🌟 **About the project**  
> Screen Recorder Studio is an open‑source, browser‑based screen recorder and editor. You can read the [source on GitHub](https://github.com/screen-recorder-studio/screen-recorder) or install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/screen-recorder-studio-fo/bondbeldfibfmdjlcnomlaooklacmfpa).

---

## 1. Architectural Decision: Escape the Main Thread

The browser’s main thread is already overloaded. It’s responsible for:

- Handling user input,
- Running JavaScript,
- Layout and style calculation,
- Painting the DOM.

Decoding a single 4K frame and drawing it to a `<canvas>` on the main thread can easily take ~20ms. If you add filters, background compositing, and layout math on top, your FPS will drop well below 60.

Our answer:

> Move as much as possible into a **dedicated worker** and render into an **OffscreenCanvas** there.

Screen Recorder Studio’s rendering stack is built around four stages:

1. **Decode**  
   A `VideoDecoder` runs inside a worker, consuming encoded chunks from OPFS.
2. **Buffer**  
   Decoded `VideoFrame`s are queued in a frame buffer (two buffers, actually: one for the current window, one for the next).
3. **Render**  
   The worker uses `OffscreenCanvas` to composite:
   - Background (color/gradient/image),
   - Cropped video,
   - Zoom & focus transformations,
   - Rounded corners & shadows.
4. **Commit**  
   Each composited frame is turned into an `ImageBitmap` and sent back to the main thread via zero‑copy transfer for display.

The main thread’s job is then reduced to:

> Wire up UI controls and tell the worker **what** to render, not **how**.

---

## 2. The Frame Buffer: Smoothing Out the Cost of GOPs

In the previous article we saw that GOP alignment sometimes forces us to decode a lot more than “just the frame the user asked for.” That cost is amortized by a **frame buffer** inside `composite-worker`.

At a high level, we implement a classic producer/consumer model:

- **Producer (decoder)**  
  The `VideoDecoder` feeds decoded `VideoFrame` objects into one of two queues:
  - `decodedFrames` for the current window,
  - `nextDecoded` for the pre‑decoded next window.
- **Consumer (renderer)**  
  A render loop running at ~60fps pulls frames from the current queue and draws them into the OffscreenCanvas.

The buffer is size‑limited:

```ts
const FRAME_BUFFER_LIMITS = {
  maxDecodedFrames: 150,  // ~5s @ 30fps
  maxNextDecoded: 120,    // ~4s @ 30fps
  warningThreshold: 0.9,
};
```

If a buffer grows beyond its limit, we:

- Drop the oldest frames, and
- Explicitly `close()` those `VideoFrame` instances to free GPU resources.

This design:

- Absorbs I/O and decoding jitter,
- Prevents memory from growing unbounded,
- Enables seamless window transitions during continuous playback.

---

## 3. The Render Loop: A Heartbeat in the Worker

Inside `src/lib/workers/composite-worker/index.ts`, we don’t wait passively for “render this one frame” commands. Instead we run an active **render loop** controlled entirely within the worker.

Simplified:

```ts
function startPlayback() {
  // Ensure we have a layout and config
  if (!currentConfig || !fixedVideoLayout) return;

  isPlaying = true;

  const fps = Math.max(1, Math.floor(videoFrameRate || 30));
  const frameInterval = 1000 / fps;
  let lastFrameTime = 0;

  function playFrame() {
    if (!isPlaying) return;

    const now = performance.now();
    if (now - lastFrameTime >= frameInterval) {
      const boundary = windowBoundaryFrames ?? decodedFrames.length;

      // Window has finished: notify main thread and stop
      if (currentFrameIndex >= boundary) {
        self.postMessage({
          type: "windowComplete",
          data: { totalFrames: boundary, lastFrameIndex: Math.max(0, currentFrameIndex - 1) },
        });
        isPlaying = false;
        currentFrameIndex = 0;
        return;
      }

      if (currentFrameIndex < decodedFrames.length) {
        const frame = decodedFrames[currentFrameIndex];
        const bitmap = renderCompositeFrame(
          frame,
          fixedVideoLayout!,
          currentConfig!,
          currentFrameIndex,
        );
        if (bitmap) {
          self.postMessage(
            {
              type: "frame",
              data: {
                bitmap,
                frameIndex: currentFrameIndex,
                timestamp: frame.timestamp,
              },
            },
            { transfer: [bitmap] },
          );
        }
        currentFrameIndex++;
        lastFrameTime = now;
      } else if (!isDecoding) {
        // No more frames and decoding has finished: end of window
        self.postMessage({
          type: "windowComplete",
          data: {
            totalFrames: decodedFrames.length,
            lastFrameIndex: currentFrameIndex - 1,
          },
        });
        isPlaying = false;
        return;
      }
    }

    animationId = self.requestAnimationFrame(playFrame);
  }

  playFrame();
}
```

Key properties:

- The loop is **timed by `videoFrameRate`**, not by incoming messages.
- It runs inside the worker using `self.requestAnimationFrame`, completely decoupled from main‑thread jank.
- When it reaches the end of the current window, it emits a `windowComplete` message. The main thread responds by requesting the next window from OPFS and the pipeline continues.

---

## 4. Compositing: More Like Photoshop Than `<video>`

The core rendering function `renderCompositeFrame` is closer to a mini Photoshop than to a simple `<video>` tag:

1. Draw background (solid, gradient, or image).
2. Compute video layout and zoom transform.
3. Apply shadow.
4. Clip to a rounded rectangle (if any).
5. Draw the cropped video frame into the target rectangle.

Let’s unpack the interesting parts.

### 4.1 Background layer

The background config supports:

- Solid color,
- Linear/radial/conic gradients,
- Custom images or wallpapers (with fit, position, blur, opacity).

In the worker:

```ts
function renderBackground(config: BackgroundConfig) {
  if (!ctx || !offscreenCanvas) return;

  if (config.type === "gradient" && config.gradient) {
    const gradientStyle = createGradient(config.gradient);
    ctx.fillStyle = gradientStyle ?? config.color;
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  } else if (config.type === "image" && config.image) {
    renderImageBackground(config.image);
  } else if (config.type === "wallpaper" && config.wallpaper) {
    renderImageBackground(config.wallpaper);
  } else {
    ctx.fillStyle = config.color;
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  }
}
```

Gradients are built using standard Canvas APIs; images are laid out with a small utility that mimics CSS’s `background-size` / `background-position` behaviors.

### 4.2 Dynamic layout and zoom: time‑driven, frame‑aligned

Zooming is implemented as a **time‑driven layout transformation**, not as a CSS animation:

- The zoom intervals live in a `videoZoom` configuration, with fields like:
  - `startMs`, `endMs`,
  - `scale`,
  - optional focus point `focusX`, `focusY`,
  - and a `focusSpace` (`"source"` vs `"layout"`).
- For each rendered frame, we compute a logical time based on **global frame index and FPS**:

  ```ts
  const globalFrameIndex = windowStartFrameIndex + frameIndex;
  const currentTimeMs = (globalFrameIndex / videoFrameRate) * 1000;
  ```

- Given `currentTimeMs`, we:
  - Find the active zoom interval (if any),
  - Apply an easing function (e.g. `easeInOutCubic`) across the entry/exit transitions,
  - Compute an interpolated `zoomScale` between 1.0 and the target scale.

This ensures:

- If playback pauses at a certain frame, the zoom is **exactly** at the right progress.
- If you scrub or play at different speeds, the zoom is always consistent with the video content – no “slipping” animations.

Zoom focus coordinates can be defined:

- In **source space** (normalized over the raw frame), or
- In **layout space** (normalized over the on‑canvas video rectangle).

When focus is in source space, we take cropping into account:

```ts
// Map source focus (0..1 in coded frame) into the cropped region
const vw = frame.codedWidth;
const vh = frame.codedHeight;
let cropX = 0, cropY = 0, cropW = vw, cropH = vh;

if (config.videoCrop?.enabled) {
  const crop = config.videoCrop;
  if (crop.mode === "percentage") {
    cropX = Math.floor((crop.xPercent ?? 0) * vw);
    cropY = Math.floor((crop.yPercent ?? 0) * vh);
    cropW = Math.floor((crop.widthPercent ?? 1) * vw);
    cropH = Math.floor((crop.heightPercent ?? 1) * vh);
  } else {
    cropX = crop.x ?? 0;
    cropY = crop.y ?? 0;
    cropW = crop.width ?? vw;
    cropH = crop.height ?? vh;
  }
}

const srcPxX = clamp01(active.focusX) * vw;
const srcPxY = clamp01(active.focusY) * vh;
const denomW = Math.max(1, cropW);
const denomH = Math.max(1, cropH);

const fx = clamp01((srcPxX - cropX) / denomW);
const fy = clamp01((srcPxY - cropY) / denomH);
```

Then we compute a zoomed layout rectangle `actualLayout` such that:

- When `zoomScale` increases, the focus point is pulled toward the center of the canvas.
- At full zoom, the chosen focus point lines up with the canvas center.

### 4.3 Decoration layer: rounded corners and shadows

Rounded corners and shadows use path clipping and a simple synthetic shadow rectangle:

```ts
const borderRadius = config.borderRadius || 0;

// Shadow underneath the video
if (config.shadow) {
  ctx.save();
  ctx.shadowOffsetX = config.shadow.offsetX;
  ctx.shadowOffsetY = config.shadow.offsetY;
  ctx.shadowBlur = config.shadow.blur;
  ctx.shadowColor = config.shadow.color;

  if (borderRadius > 0) {
    createRoundedRectPath(
      actualLayout.x,
      actualLayout.y,
      actualLayout.width,
      actualLayout.height,
      borderRadius,
    );
    ctx.fill();
  } else {
    ctx.fillRect(actualLayout.x, actualLayout.y, actualLayout.width, actualLayout.height);
  }
  ctx.restore();
}

// Rounded‑corner mask for the video content
ctx.save();
if (borderRadius > 0) {
  createRoundedRectPath(
    actualLayout.x,
    actualLayout.y,
    actualLayout.width,
    actualLayout.height,
    borderRadius,
  );
  ctx.clip();
}
```

The video content is then drawn via the 9‑argument form of `drawImage`, combining:

- Source cropping (for the user’s crop selection), and
- Target layout (for zoom and positioning):

```ts
ctx.drawImage(
  frame,
  srcX,
  srcY,
  srcWidth,
  srcHeight,
  actualLayout.x,
  actualLayout.y,
  actualLayout.width,
  actualLayout.height,
);
```

---

## 5. Zero‑Copy: Moving Frames Without Moving Bytes

At the end of `renderCompositeFrame`, we convert the OffscreenCanvas contents into an `ImageBitmap`:

```ts
const bitmap = offscreenCanvas.transferToImageBitmap();
self.postMessage(
  { type: "frame", data: { bitmap, frameIndex, timestamp: frame.timestamp } },
  { transfer: [bitmap] },
);
```

On the main thread, `VideoPreviewComposite` listens for these messages and renders them into a `<canvas>` using the `bitmaprenderer` context:

```ts
let bitmapCtx: ImageBitmapRenderingContext | null = null;

function displayFrame(bitmap: ImageBitmap, frameIndex?: number) {
  if (!bitmapCtx) return;
  bitmapCtx.transferFromImageBitmap(bitmap);

  if (typeof frameIndex === "number") {
    currentFrameIndex = frameIndex;
    // Update logical time based on global frame index and FPS
    currentTime = (lastFrameWindowStartIndex + frameIndex) / frameRate;
  }
}
```

Because we use **transferable objects**:

- No pixel buffers are copied between worker and main thread.
- Only a handle to the underlying GPU resource is moved.

This makes 4K@60fps rendering and preview feasible in a real browser, not just in theory.

---

## 6. Preview vs Export: What You See Is What You Encode

One detail that often gets overlooked in video tools is **consistency between preview and export**.

In Screen Recorder Studio, the pipeline you’ve just seen does not only power the on‑screen preview. It is also reused during export:

- The export worker (`export-worker/index.ts`) spins up the same `video-composite-worker`.
- We convert the Svelte background configuration into a plain object using `convertBackgroundConfigForExport`, including:
  - Background type/color/gradient/image,
  - Padding and inset,
  - Border radius and shadow,
  - **Video crop configuration**,
  - **Video zoom configuration** (intervals, focus points, easing).
- For MP4/WebM/GIF export, we render each frame via this composite worker into an OffscreenCanvas and then hand those frames off to the encoder (e.g. Mediabunny for MP4).

In other words:

> The same composite code path is responsible for both **preview** and **export**.  
> Visually, you can treat it as **WYSIWYE – What You See Is What You Encode**.

---

## 7. Closing Thoughts: Native‑Grade Video Editing, in a Tab

This three‑part series has covered the three pillars behind Screen Recorder Studio:

1. **Memory** – A sliding window over OPFS turns “file size” into “window size,” keeping memory usage bounded.
2. **Random access** – `index.jsonl` + GOP‑aware seeking make frame‑accurate access practical on top of a browser file system.
3. **Rendering** – OffscreenCanvas + workers + an explicit compositing pipeline bring native‑style video rendering into the web platform.

Taken together, these are the pieces that allow a browser tab to behave like a serious video application rather than a toy.

As WebCodecs, OPFS, and eventually WebGPU continue to mature, we believe the browser will increasingly become not just a content consumption platform, but a **production** environment as well.

If this series sparked ideas or questions, feel free to explore the code, open issues, or build on top of it. There’s a lot of room left to push web‑based video tools further.

---

> **Previous**: [Web Video Editing Engine (2): Frame‑Accurate Seeking with OPFS and GOP Alignment](./05-editor-seeking-gop-alignment.en.md)


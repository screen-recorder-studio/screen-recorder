# SRS Master Calibration Chart (Benchmark Tool)

**Version:** 4.0 (Crop/Trim Edition)  
**URL:** `lab/test-pattern/index.html`

This tool is a comprehensive, browser-based test pattern generator designed to validate the performance, accuracy, and encoding quality of the Screen Recorder Studio (and other video capture software).

It replaces static test images with a dynamic, deterministic render loop to expose issues related to **bitrate, frame pacing, chroma subsampling, and audio synchronization**.

---

## 🎯 Test Zones & Interpretation Guide

The screen is divided into 8 active zones, each targeting a specific encoding artifact.

### 1. Bitrate Stress (Entropy Noise)
*   **Location:** Top-Left Panel
*   **What it does:** Renders high-frequency random noise (TV static) at 60fps.
*   **Engineering Goal:** Forces the video encoder (H.264/VP9/AV1) to max out its bitrate budget. Since there is no temporal redundancy, Inter-frame compression fails.
*   **How to Interpret:**
    *   **Pass:** The noise looks sharp and grainy.
    *   **Fail:** The noise turns into large, muddy blocks (Macroblocking). Frame rate drops significantly.

### 2. Chroma Subsampling (4:2:0 Torture Test)
*   **Location:** Top-Center Panel
*   **What it does:** Displays text with specific color combinations (Red on Blue, Cyan on Red).
*   **Engineering Goal:** Most screen recorders use YUV 4:2:0 color space, which halves color resolution.
*   **How to Interpret:**
    *   **Pass (4:4:4):** Text edges are sharp and crisp.
    *   **Fail (4:2:0):** The text is blurry, unreadable, or has black lines around the edges. This confirms the recorder is compressing color data.

### 3. Stereo Audio Sync
*   **Location:** Top-Center (Visual) & Audio Output
*   **What it does:** Plays alternating tones: Low Pitch (Left Channel) -> High Pitch (Right Channel) every 2 seconds. Visual indicators (`L` / `R`) light up in perfect sync.
*   **How to Interpret:**
    *   **Sync:** The sound happens exactly when the light flashes.
    *   **Channel Check:** If you hear both sounds in both ears (Mono), the recorder has a stereo mixing bug.

### 4. Render Jitter Graph
*   **Location:** Top-Right Panel
*   **What it does:** Plots the time difference between frames (should be ~16.6ms for 60Hz).
*   **How to Interpret:**
    *   **Green Bars:** The browser is rendering smoothly.
    *   **Red Bars:** The browser itself is lagging.
    *   **Diagnosis:** If the *Recording* stutters but these bars were *Green*, the fault lies with the Recorder, not the source PC.

### 5. Dynamic Zone Plate (Aliasing)
*   **Location:** Middle-Left Panel
*   **What it does:** Renders a concentric sine-wave pattern that shifts phase slowly.
*   **How to Interpret:**
    *   **Fail:** If the moving rings flicker violently or show "moire patterns" that aren't in the original, the scaler/resizer quality is poor.

### 6. Center Stage (Timing & Crop)
*   **Location:** Center
*   **Features:**
    *   **Siemens Star:** Rotating vector graphic. Reveals "tearing" (horizontal cut lines) if V-Sync is broken.
    *   **Timecode:** `MM:SS:ms`. Frame-accurate timestamp for latency measurement.
    *   **Binary Counter:** 16-bit binary display of the frame number. Used for automated drop-frame detection scripts.
    *   **Temporal Color Phase:** The global theme changes every 10 seconds (Blue->Green->Red->Yellow).
        *   *Usage:* Verify "Trim" operations. (e.g., "Trim start to 00:15" -> Video must start with Green theme).

### 7. Bit Depth (Banding)
*   **Location:** Bottom-Left Panel
*   **What it does:** Displays a 32-step quantized grayscale ramp vs a smooth gradient.
*   **How to Interpret:**
    *   **Fail:** If the 32 distinct steps merge into fewer, larger blocks, the encoder is reducing bit depth or aggressive compression is smoothing out details.

### 8. Motion & Tearing
*   **Location:** Bottom Panel
*   **What it does:** A UFO moves horizontally at fixed speed across vertical tearing check lines.
*   **How to Interpret:**
    *   **Stutter:** If the UFO motion isn't smooth, frame pacing is uneven.

---

## 📐 Fullscreen Features

### Coordinate Grid Wallpaper (New in v4)
The background is a generated grid with `(x, y)` coordinates printed at every 100px intersection.
*   **Usage:** Validate **Crop** features.
*   **Example:** If you set Crop to `x:100, y:100`, the top-left corner of the video should show exactly the intersection labeled `100,100`.

### Performance Architecture
*   **Noise Generation:** Uses a pre-calculated buffer of 4 noise frames to simulate high entropy without blocking the Main Thread (CPU usage < 5%).
*   **Synchronization:** All animations (Star, UFO, Lights) are driven by a single `requestAnimationFrame` loop using `AudioContext.currentTime` or `performance.now()` as the master clock.

---

## 🛠 Usage Instructions

1.  **Open:** Open `lab/test-pattern/index.html` in Chrome.
2.  **Start:** Click anywhere to initialize the Audio Context.
3.  **Fullscreen:** Press F11 for best results (removes browser UI).
4.  **Record:** Start your screen recording.
5.  **Analyze:** Play back the file and check against the interpretations above.

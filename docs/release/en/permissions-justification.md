## Permissions Justification

To the Chrome Web Store Review Team,

We are providing this document to explain why our extension, Screen Recorder Studio, requires the permissions listed in our manifest. Our commitment is to use these permissions strictly for the core functionalities of our extension and to ensure user privacy is always protected.

### 1. `desktopCapture`

*   **Justification:** This is the core permission for our screen recording functionality. It allows users to capture their screen, a specific application window, or a browser tab to create video content.

### 2. `downloads`

*   **Justification:** This permission enables users to save their recorded videos directly to their local file system. This is a fundamental feature for an offline-first screen recorder.

### 3. `storage`

*   **Justification:** We use this permission to store the user's settings and preferences locally, such as preferred video format, quality, and frame rate. This ensures a consistent user experience across sessions.

### 4. `unlimitedStorage`

*   **Justification:** High-resolution and long-duration screen recordings can result in large file sizes. This permission is necessary to prevent the browser from clearing the stored video data before the user has a chance to save it.

### 5. `sidePanel`

*   **Justification:** This permission is used to display our extension's user interface in the browser's side panel, providing a non-intrusive and easily accessible control center for recording.

### 6. `activeTab` & `scripting`

*   **Justification:** These permissions are required for our element selection feature. They allow the user to select a specific HTML element on a page to record, which requires injecting a script into the active tab to identify the element's boundaries.

### 7. `tabs`

*   **Justification:** This permission is used to manage the recording state across different tabs, especially when initiating a tab recording, to ensure the correct tab is being captured.

### 8. `offscreen`

*   **Justification:** To ensure a smooth and stable recording experience, especially for long recordings, we use the `offscreen` permission to run parts of the recording and encoding process in a background document. This prevents the main UI from becoming unresponsive.

### 9. `host_permissions: ["<all_urls>"]`

*   **Justification:** This permission is strictly required for the element selection feature to work on any website the user visits. Without it, the content script needed to identify and select elements cannot be injected, and the feature would be broken. We do not collect any data or track user activity with this permission.

We assure you that all permissions are used responsibly and are essential for providing the features that make Screen Recorder Studio a powerful and user-friendly screen recorder. We are committed to transparency and user privacy.

Thank you for your time and consideration.

Sincerely,
The Screen Recorder Studio Team
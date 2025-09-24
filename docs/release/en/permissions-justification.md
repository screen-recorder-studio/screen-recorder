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

### 6. `activeTab`

*   **Justification:** This permission grants temporary access to the currently active tab when the user clicks the extension icon. It is used to initiate the "Area Recording" and "Element Recording" features on the user's command, providing a privacy-friendly way to interact with the page without requiring persistent access.

### 7. `scripting`

*   **Justification:** This permission is essential for our "Area Recording" and "Element Recording" features. It allows the extension to inject scripts into the active webpage. These scripts are responsible for creating the visual overlay for area selection and for identifying the specific HTML element the user wishes to record. This permission is used only when the user activates these features.

### 8. `tabs`

*   **Justification:** This permission is used to get the title and URL of the active tab to set it as the default file name for the recording. It also helps manage the recording state across different tabs, ensuring the correct tab is being captured when initiating a tab recording.

### 9. `offscreen`

*   **Justification:** To ensure a smooth and stable recording experience, especially for long recordings, we use the `offscreen` permission to run parts of the recording and encoding process in a background document. This prevents the main UI from becoming unresponsive.

### 10. `host_permissions: ["<all_urls>"]`

*   **Justification:** This permission is strictly required for the "Area Recording" and "Element Recording" features to function on any website the user visits. It allows our content scripts to be injected to draw the selection overlay and identify element boundaries. We do not collect any data or track user activity with this permission; it is used solely to enable on-page recording functionality.

We assure you that all permissions are used responsibly and are essential for providing the features that make Screen Recorder Studio a powerful and user-friendly screen recorder. We are committed to transparency and user privacy.

Thank you for your time and consideration.

Sincerely,
The Screen Recorder Studio Team
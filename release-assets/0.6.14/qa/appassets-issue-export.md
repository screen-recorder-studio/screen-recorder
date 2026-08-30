# Standard export fails with `multilingual_export_incomplete` after replacing image with local PNG

## Environment

- GetAppAssets: 0.5.5
- Browser: Chrome on macOS
- Canvas preset: Chrome Store screenshot, 1280 × 800
- Versions: source English plus Russian, Simplified Chinese, and Traditional Chinese

## Steps to reproduce

1. Create a Chrome Store screenshot document.
2. Add a main image captured from another installed extension.
3. Add three language versions and complete localization review.
4. Use Standard export.
5. Replace the main image with a local PNG and retry Standard export.

## Actual result

Multilingual export fails before a download is created. The UI reports that English could not be prepared and surfaces this error:

```text
multilingual_export_incomplete:en:missing_export_image:f9bb5fd2-0d65-45e2-9634-63d9a446c42d
```

Replacing the main image with a local PNG does not resolve the failure.

Single-language Standard export also fails for localized versions, for example:

```text
Failed to prepare 中文（台灣） for export.
```

After a source-layout change and language recheck, affected localized versions can fail before the Export Preview is produced, leaving no clean preview to save manually.

## Expected result

Standard export should create the selected image or multilingual ZIP when every language version is marked ready to export.

## Impact

This blocks both the normal multilingual delivery path and the clean-preview fallback for otherwise valid localized store assets. The current workaround is to deselect every layer, capture the GetAppAssets editor canvas, and crop it deterministically to 1280 × 800.

# Screen recordings are mistranslated as audio recordings in zh-CN and zh-TW

## Environment

- GetAppAssets: 0.5.5
- Source context: Chrome screen recorder store screenshot
- Source headline: `Your recordings stay on your device`
- Source subtitle: `Find, reopen, and manage every local take`

## Actual result

Semantic localization interprets screen/video recordings as audio recordings:

- Simplified Chinese headline: `您的录音仅保存在您的设备上`
- Simplified Chinese subtitle: `查找、重新打开并管理所有本地录音文件`
- Traditional Chinese headline: `您的錄音檔僅儲存於您的裝置中`
- Traditional Chinese subtitle: `搜尋、重新開啟並管理所有本機錄音`

In a screen-recorder context, `录音` / `錄音檔` means audio recording and changes the product meaning.

## Expected result

Use screen/video recording terminology such as `录制文件` in Simplified Chinese and `錄製檔案` in Traditional Chinese. Product category, surrounding screenshot text, and a terminology glossary should influence semantic localization.

## Suggested direction

- Include document/product context in the localization prompt.
- Let projects define protected terminology mappings.
- Flag high-risk polysemes such as `recording` for review when the product category is screen capture.

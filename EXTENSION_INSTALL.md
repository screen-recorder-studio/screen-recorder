# Chrome 扩展安装说明

## 方法 1: 开发者模式安装（推荐）

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目的 `build` 目录

## 方法 2: 打包文件安装

1. 解压 `screen-recorder-extension.zip` 文件
2. 按照方法 1 的步骤，选择解压后的目录

## 使用说明

1. 安装完成后，Chrome 工具栏会出现扩展图标
2. 点击扩展图标打开 sidepanel 录制面板
3. 在 sidepanel 中可以开始屏幕录制

## 故障排除

### 扩展无法加载
- 确保 Chrome 版本 >= 116
- 检查 manifest.json 文件是否存在
- 确保没有以 `_` 开头的文件或目录

### Sidepanel 无法打开
- 确保 Chrome 支持 sidepanel API
- 检查 `sidepanel.html` 文件是否存在
- 查看 Chrome 开发者工具的控制台错误

## 开发说明

- 修改代码后运行 `pnpm run build:extension` 重新构建
- 在 Chrome 扩展页面点击刷新按钮更新扩展
- 使用 `pnpm run dev` 进行开发调试（需要单独加载到扩展中）
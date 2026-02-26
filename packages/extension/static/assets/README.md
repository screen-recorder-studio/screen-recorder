# 扩展图标

请在此目录放置以下图标文件：
- icon16.png (16x16 像素)
- icon48.png (48x48 像素)  
- icon128.png (128x128 像素)

这些图标将用于 Chrome 扩展的显示。

## 临时解决方案

如果没有图标文件，可以使用以下命令生成简单的占位符图标：

```bash
# 需要安装 ImageMagick 或其他图像处理工具
# convert icon.svg -resize 16x16 icon16.png
# convert icon.svg -resize 48x48 icon48.png  
# convert icon.svg -resize 128x128 icon128.png
```

或者暂时移除 manifest.json 中的 icons 配置。
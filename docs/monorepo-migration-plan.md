# Monorepo 迁移技术方案

## 1. 项目现状分析

### 1.1 当前目录结构

```
/
├── package.json              # 单包项目，名称 screen-recorder-studio
├── pnpm-lock.yaml
├── .npmrc                    # engine-strict=true
├── svelte.config.js          # SvelteKit + Chrome Extension adapter
├── vite.config.ts            # Vite 7 + Tailwind CSS 4
├── tsconfig.json             # 扩展 .svelte-kit/tsconfig.json
├── src/
│   ├── app.html / app.css    # SvelteKit 入口
│   ├── extensions/           # Chrome 扩展脚本 (background, content, offscreen, worker)
│   ├── lib/                  # 核心库 ($lib 别名)
│   │   ├── assets/           # SVG 图标
│   │   ├── components/       # Svelte 5 组件 (UI、导出、裁剪等)
│   │   ├── data/             # 数据预设 (壁纸)
│   │   ├── services/         # 录制服务、导出管理、GIF 编码
│   │   ├── stores/           # Svelte 5 runes 状态管理 ($state)
│   │   ├── types/            # TypeScript 类型定义
│   │   ├── utils/            # 工具函数 (Chrome API, WebCodecs, Offscreen)
│   │   ├── workers/          # Web Workers (OPFS 读写, 导出, 合成)
│   │   └── index.ts          # 核心导出入口
│   ├── lab/                  # 实验性 SvelteKit 页面
│   └── routes/               # SvelteKit 路由页面 (12 个入口)
├── scripts/                  # 构建脚本 (Vite 二次构建扩展入口)
├── static/                   # 静态资源 (manifest.json, offscreen.html, 图标, 壁纸)
├── lab/                      # 独立实验/测试项目 (11 个子目录，无 package.json)
├── docs/                     # 技术文档
└── blog/                     # 博客文章
```

### 1.2 核心依赖

| 依赖 | 类型 | 版本 | 用途 |
|------|------|------|------|
| svelte | dev | ^5.0.0 | UI 框架 (runes) |
| @sveltejs/kit | dev | ^2.22.0 | 应用框架 |
| sveltekit-adapter-chrome-extension | dev | ^2.0.1 | Chrome 扩展适配器 |
| vite | dev | ^7.0.4 | 构建工具 |
| typescript | dev | ^5.0.0 | 类型系统 |
| svelte-check | dev | ^4.0.0 | 类型检查 |
| @sveltejs/adapter-static | dev | ^3.0.9 | 静态适配器（备用） |
| @sveltejs/vite-plugin-svelte | dev | ^6.0.0 | Vite Svelte 插件 |
| @types/chrome | dev | ^0.0.270 | Chrome API 类型 |
| @types/gif.js | dev | ^0.2.5 | GIF.js 类型 |
| @types/node | dev | ^22.18.0 | Node.js 类型 |
| tailwindcss | prod | ^4.1.12 | CSS 框架 |
| @tailwindcss/vite | prod | ^4.1.12 | Tailwind Vite 插件 |
| @lucide/svelte | prod | ^0.542.0 | 图标库 |
| gif.js | prod | ^0.2.0 | GIF 编码 |
| mediabunny | prod | ^1.14.2 | 媒体处理 |

### 1.3 构建流程

1. `vite build` — SvelteKit 构建所有路由页面到 `build/`
2. `build-content.mjs` — 独立构建 `content.js` (IIFE)
3. `build-background.mjs` — 独立构建 `background.js` (ESM)
4. `build-worker.mjs` — 独立构建 `encoder-worker.js` (IIFE)
5. `build-opfs-writer.mjs` — 独立构建 `opfs-writer.js` (ESM)
6. `build-opfs-writer-worker.mjs` — 独立构建 `opfs-writer-worker.js` (ESM)
7. `build-offscreen2.mjs` — 独立构建 `offscreen.js` (IIFE)
8. 复制 `manifest.json` 到 `build/`

### 1.4 关键特性

- **Svelte 5 Runes**: 使用 `$state` 进行状态管理
- **Chrome MV3**: 使用 Offscreen API
- **WebCodecs**: 主要编码管线; MediaRecorder 作为后备
- **OPFS**: Origin Private File System 存储录制数据
- **$lib 别名**: SvelteKit 内置路径别名，36 个文件使用
- **无 $app 导入**: 不使用 SvelteKit 运行时 API

---

## 2. 迁移方案设计

### 2.1 目标结构

```
/
├── pnpm-workspace.yaml        # pnpm 工作区配置
├── package.json               # 根工作区 package.json
├── .npmrc
├── .gitignore
├── CLAUDE.md, GEMINI.md       # AI 上下文文档
├── README.md, README.ZH.md    # 项目说明
├── LICENSE, SECURITY.md, etc. # 项目元数据
├── packages/
│   └── extension/             # 主 Chrome 扩展包
│       ├── package.json
│       ├── svelte.config.js
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── src/               # 原 src/ 目录
│       ├── scripts/           # 原 scripts/ 目录
│       └── static/            # 原 static/ 目录
├── lab/                       # 独立实验项目 (不作为 workspace 包)
├── docs/                      # 技术文档
└── blog/                      # 博客文章
```

### 2.2 设计决策

#### 为什么不拆分 shared 包？

经过分析，当前 `src/lib/` 的所有模块（services、stores、utils、workers、types）与 Chrome Extension API 和 OPFS 紧耦合，仅被 extension 内部消费，暂无独立复用场景。过度拆分会：

1. 增加不必要的构建复杂度
2. 破坏 SvelteKit 的 `$lib` 路径别名机制（36 个文件需改动）
3. 增加 Worker 文件路径解析的复杂度

**建议**: 先建立 Monorepo 基础架构，后续根据需求渐进式拆包。

#### 为什么 lab/ 不作为 workspace 包？

`lab/` 目录包含 11 个独立的 HTML 实验项目，无 `package.json`，不依赖主项目代码，适合作为纯静态实验保留在根目录。

### 2.3 迁移步骤

#### 步骤 1: 创建根工作区配置

创建 `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

#### 步骤 2: 重构根 package.json

将根 `package.json` 转换为工作区管理角色：
- 移除所有 `dependencies` 和 `devDependencies`
- 添加工作区级脚本 (`dev`, `build`, `check` 等)
- 保留 `private: true`

#### 步骤 3: 创建 packages/extension/

1. 移动 `src/` → `packages/extension/src/`
2. 移动 `scripts/` → `packages/extension/scripts/`
3. 移动 `static/` → `packages/extension/static/`
4. 移动 `svelte.config.js` → `packages/extension/svelte.config.js`
5. 移动 `vite.config.ts` → `packages/extension/vite.config.ts`
6. 移动 `tsconfig.json` → `packages/extension/tsconfig.json`
7. 创建 `packages/extension/package.json`（包含所有依赖）

#### 步骤 4: 更新路径和配置

1. 更新 `packages/extension/svelte.config.js` — 路径已相对，无需改动
2. 更新 `packages/extension/vite.config.ts` — 路径已相对，无需改动
3. 更新 `packages/extension/tsconfig.json` — 路径已相对，无需改动
4. 更新 `.gitignore` — 调整构建输出路径
5. 更新根 `CLAUDE.md` 和 `GEMINI.md` — 更新路径描述

#### 步骤 5: 更新构建脚本路径

所有 `scripts/*.mjs` 中的路径都是相对路径（如 `src/extensions/content.ts`），
在 `packages/extension/` 下运行时路径不变，无需修改。

#### 步骤 6: 验证

1. `pnpm install` — 验证工作区依赖安装
2. `pnpm --filter extension dev` — 验证开发服务器
3. `pnpm --filter extension check` — 验证类型检查
4. `pnpm --filter extension build:extension` — 验证完整构建

---

## 3. 风险评估

| 风险项 | 影响 | 概率 | 缓解措施 |
|--------|------|------|----------|
| $lib 路径别名失效 | 高 | 低 | SvelteKit $lib 基于项目相对路径，迁移后不受影响 |
| 构建脚本路径错误 | 中 | 低 | scripts/ 使用相对路径，随包一起移动 |
| pnpm-lock.yaml 冲突 | 中 | 中 | 迁移后重新生成 lockfile |
| .svelte-kit 缓存问题 | 低 | 中 | 清理缓存后重新构建 |

---

## 4. 迁移后的开发命令

```bash
# 根目录命令 (通过工作区脚本代理)
pnpm dev                      # 启动开发服务器
pnpm build                    # 构建扩展
pnpm check                    # 类型检查

# 指定包命令
pnpm --filter extension dev
pnpm --filter extension build:extension
pnpm --filter extension check

# 安装依赖
pnpm add <package> --filter extension          # 添加到 extension 包
pnpm add -D <package> --filter extension       # 添加 dev 依赖
```

---

## 5. 后续扩展建议

Monorepo 基础架构建立后，可根据需求逐步拆分新包：

1. **`packages/shared`** — 提取通用类型定义和工具函数（当出现第二个消费者时）
2. **`packages/docs`** — 如需文档站点，可使用 VitePress 等工具
3. **`packages/web-app`** — 如需 Web 版录制工具（非扩展版本）
4. **`packages/lab`** — 如实验项目需要共享依赖

---

## 6. 文件变动清单

### 新建文件
- `pnpm-workspace.yaml`
- `packages/extension/package.json`

### 移动文件
- `src/` → `packages/extension/src/`
- `scripts/` → `packages/extension/scripts/`
- `static/` → `packages/extension/static/`
- `svelte.config.js` → `packages/extension/svelte.config.js`
- `vite.config.ts` → `packages/extension/vite.config.ts`
- `tsconfig.json` → `packages/extension/tsconfig.json`

### 修改文件
- `package.json` — 转为工作区根配置
- `.gitignore` — 更新构建输出路径
- `CLAUDE.md` — 更新路径描述
- `GEMINI.md` — 更新路径描述

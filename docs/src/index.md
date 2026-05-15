# Note Demo（知识库模板使用指南）

这个项目由两部分组成：

- **应用页（Vite）**：用于承载自定义页面/组件（默认端口 `5173`）
- **文档站（VitePress）**：用于写作与展示知识库（默认端口 `5174`）

并且内置了一个右下角的 **AI 问答聊天框**（流式输出 + IndexedDB 保留对话 + 可选本地知识库检索）。

---

## 1. 安装与启动

安装依赖：

```bash
pnpm install
```

启动（推荐）：

```bash
# 同时启动 App(5173) + Docs(5174)
pnpm run dev:all
```

分别启动：

```bash
pnpm run dev:app
pnpm run docs:dev
```

构建与预览：

```bash
pnpm run build
pnpm run docs:build

pnpm run preview
pnpm run docs:preview
```

---

## 2. 配置 AI（必选）

在项目根目录创建 `.env.local`（或 `.env`），填写：

```ini
VITE_OPENROUTER_API_KEY=你的key
VITE_OPENROUTER_MODEL=google/gemini-2.0-flash-001

# 可选：本地知识库检索需要 embedding
VITE_OPENROUTER_EMBEDDING_MODEL=text-embedding-3-large
```

说明：

- 使用 `VITE_` 前缀是为了让变量能被前端读取。
- 如果你接的是 OpenAI-compatible 网关，也可以在网关侧做 OpenRouter 兼容或改造请求（本模板默认使用 OpenRouter SDK）。

---

## 3. 写文档（最常用）

### 3.1 新增一个页面

在 `docs/src/` 下新建一个 Markdown 文件，例如：

```
docs/src/guide/quick-start.md
```

它对应的路由一般是：

```
/guide/quick-start
```

### 3.2 让它出现在侧边栏

编辑 `docs/.vitepress/config.ts` 的 `themeConfig.sidebar`，加入：

```ts
sidebar: [
  { text: "使用指南", link: "/" },
  {
    text: "指南",
    items: [{ text: "快速开始", link: "/guide/quick-start" }],
  },
];
```

---

## 4. 本地知识库检索（manifest / vectors）

开启聊天框中的“使用本地知识库”后，会尝试加载：

- `/kb/manifest.json`
- `/kb/vectors.bin`

### 4.1 放在哪个目录？（非常重要）

取决于你当前运行的是哪个站点：

- **Vite（5173）**：放在项目根 `public/kb/`
- **VitePress（5174）**：放在 `docs/public/kb/`

如果你在 5174 上看到 `GET /kb/manifest.json 404`，通常就是文件放错了目录。

Windows 下复制示例：

```powershell
New-Item -ItemType Directory -Force docs\public\kb
Copy-Item -Force public\kb\manifest.json docs\public\kb\manifest.json
Copy-Item -Force public\kb\vectors.bin docs\public\kb\vectors.bin
```

### 4.2 自定义知识库文件 URL（可选）

可以用环境变量覆盖：

```ini
VITE_KB_MANIFEST_URL=/kb/manifest.json
VITE_KB_VECTORS_URL=/kb/vectors.bin
```

---

## 5. 使用 AI 问答聊天框

在文档站页面右下角看到悬浮按钮：

- 点击打开后输入问题并发送
- 支持流式输出
- 开启“使用本地知识库”后，会先检索本站文档片段再回答
- 点击“清空”会删除当前会话并新建会话 id（等价于“无记忆重开”）

对话记录默认保存在浏览器的 IndexedDB 中。

---

## 6. 常见问题排查

### 6.1 缺少 API KEY / MODEL

- 检查 `.env.local` 里是否配置 `VITE_OPENROUTER_API_KEY` 和 `VITE_OPENROUTER_MODEL`

### 6.2 404：/kb/manifest.json

- 你在跑 VitePress（5174）时，需要把文件放在 `docs/public/kb/`

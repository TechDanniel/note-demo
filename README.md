# 项目概览

该项目用 VitePress 快速构建文档，用于搭建个人知识库。

# 技术栈

VitePress / Vue / Vite

# 快速开始

- 启动 Vite（App，默认端口 5173）：`pnpm run dev:app`
- 启动 VitePress（Docs，端口 5174）：`pnpm run docs:dev`
- 同时启动（App + Docs）：`pnpm run dev:all`


## 拓展功能

设置环境变量：

- `OPENAI_BASE_URL`：OpenAI-compatible 网关地址
- `OPENAI_MODEL`：模型名称

为 Markdown 自动生成摘要（需要 `OPENAI_API_KEY`）：

`knowledge-base ai summarize --cwd note-demo --file docs/index.md --target generic --install`
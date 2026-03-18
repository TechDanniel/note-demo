
# 主题配置（themeConfig）

本文讲解 VitePress 的主题配置（`themeConfig`），重点说明：

- `nav` 顶部导航怎么写、链接怎么填
- `sidebar` 侧边栏怎么组织层级
- 文档“路由/链接”是如何从文件结构生成的（你应该填什么 `link`）

本项目的配置文件在：`docs/.vitepress/config.ts`。

---

## 先理解：路由是怎么来的

VitePress 的页面路由，来自 **`srcDir` 目录下的 Markdown 文件路径**。

本项目配置了：

```ts
srcDir: './src'
```

而你启动时通常是 `vitepress dev docs`（root = `docs`），所以：

- 实际内容目录是：`docs/src`
- 路由基于 `docs/src` 下的 `.md` 文件生成

### 路由规则（常用）

假设有这些文件：

```
docs/src/index.md
docs/src/useVitePress/themeConfig.md
docs/src/guide/index.md
docs/src/guide/quick-start.md
```

对应路由一般是：

- `docs/src/index.md` → `/`
- `docs/src/useVitePress/themeConfig.md` → `/useVitePress/themeConfig`
- `docs/src/guide/index.md` → `/guide/`
- `docs/src/guide/quick-start.md` → `/guide/quick-start`

> 说明：
> - `index.md` 会映射到目录根路由。
> - 本项目开启了 `cleanUrls: true`，因此链接通常不需要写 `.html`。
> - 本项目设置了 `base: '/docs/'`，部署到子路径时站点根会变成 `/docs/`，但配置里的链接仍建议写成以 `/` 开头的“站内绝对路径”（例如 `/useVitePress/themeConfig`）。

---

## themeConfig 是什么

`themeConfig` 是默认主题（Default Theme）的配置入口，常见用于：

- 顶部导航 `nav`
- 侧边栏 `sidebar`
- 搜索、页脚、社交链接、outline 等

本项目里（节选）：

```ts
themeConfig: {
	nav: [{ text: 'first start', link: '/' }],

	sidebar: [
		{ text: '使用指南', link: '/' },
		{
			text: 'vitePress使用',
			items: [{ text: '主题配置', link: '/useVitePress/themeConfig' }]
		}
	]
}
```

---

## nav：顶部导航

`nav` 是一个数组，每一项至少包含：

- `text`: 显示文本
- `link`: 站内链接（推荐以 `/` 开头）或外链 URL

### 1）最简单写法

```ts
nav: [
	{ text: '首页', link: '/' },
	{ text: '主题配置', link: '/useVitePress/themeConfig' },
]
```

### 2）下拉菜单

```ts
nav: [
	{
		text: '指南',
		items: [
			{ text: '快速开始', link: '/guide/quick-start' },
			{ text: '主题配置', link: '/useVitePress/themeConfig' },
		],
	},
]
```

### link 应该怎么填

核心原则：**`link` 写“路由路径”，而路由来自 Markdown 的文件路径**。

例如：

- 你创建了 `docs/src/guide/quick-start.md`
- 那么对应 `link` 就是 `/guide/quick-start`

---

## sidebar：侧边栏

`sidebar` 的目标是把页面按层级组织起来，常见结构如下：

- 一级：分组标题（比如“使用指南”、“组件”）
- 二级：分组下面的页面列表（`items`）

### 1）数组形式（全站统一侧边栏）

适合小站点，所有页面都显示同一个侧边栏：

```ts
sidebar: [
	{ text: '使用指南', link: '/' },
	{
		text: 'VitePress 使用',
		items: [
			{ text: '主题配置', link: '/useVitePress/themeConfig' },
			{ text: '快速开始', link: '/guide/quick-start' },
		],
	},
]
```

### 2）对象形式（按路由前缀切换侧边栏）

当你希望“不同栏目有不同侧边栏”，用对象形式更合适：

```ts
sidebar: {
	'/guide/': [
		{
			text: '指南',
			items: [
				{ text: '快速开始', link: '/guide/quick-start' },
			],
		},
	],
	'/useVitePress/': [
		{
			text: 'VitePress 使用',
			items: [
				{ text: '主题配置', link: '/useVitePress/themeConfig' },
			],
		},
	],
}
```

含义是：

- 当前路由以 `/guide/` 开头 → 使用 `sidebar['/guide/']`
- 当前路由以 `/useVitePress/` 开头 → 使用 `sidebar['/useVitePress/']`

### sidebar 的常用字段

侧边栏项（以及分组）常用字段：

- `text`: 显示名称
- `link`: 点击后跳转的路由（可选；如果是分组一般不写）
- `items`: 子项数组（可选）
- `collapsed`: 是否默认折叠分组（可选）

示例：

```ts
{
	text: '指南',
	collapsed: false,
	items: [
		{ text: '快速开始', link: '/guide/quick-start' },
		{ text: '更多配置', link: '/guide/more' },
	],
}
```

---

## 实操：新增一个页面并挂到 nav/sidebar

1）创建页面文件（决定路由）

例如新增：`docs/src/guide/quick-start.md`

2）在 `docs/.vitepress/config.ts` 中添加配置

- `nav`：可选（想在顶部出现才加）
- `sidebar`：推荐加到对应分组的 `items`

```ts
nav: [
	{ text: '快速开始', link: '/guide/quick-start' },
],

sidebar: {
	'/guide/': [
		{
			text: '指南',
			items: [{ text: '快速开始', link: '/guide/quick-start' }],
		},
	],
},
```

---

## 常见踩坑

1）`link` 写成了文件系统路径

- ❌ `docs/src/guide/quick-start.md`
- ✅ `/guide/quick-start`

2）`srcDir` 影响路由根

你改了 `srcDir`，所有页面的“路由根”都会跟着变，因此 `nav/sidebar` 的 `link` 也要同步调整。

3）`base` 影响部署路径，不影响 link 写法

配置 `base: '/docs/'` 时：

- 你依然写 `link: '/guide/quick-start'`
- 部署后实际访问会是 `/docs/guide/quick-start`


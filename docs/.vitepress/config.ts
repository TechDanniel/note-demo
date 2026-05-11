import { defineConfig } from 'vitepress'
import { resolve } from 'node:path'

const APP_URL = process.env.VITEPRESS_APP_URL || 'http://localhost:5173/'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Note Demo',
  description: '一个最小可用的 VitePress 文档站点示例。',

  base: '/docs/',

  cleanUrls: true,
  lastUpdated: true,

  vite: {
    configFile: false,
	envDir: resolve(__dirname, '../..'),
  },

  srcDir: './src',

  themeConfig: {
    nav: [
        { text: 'Quick Start', link: '/' },
        { text: '首页', link: APP_URL }
    ],

    sidebar: [
      { text: '使用指南',link: '/' },
      { 
        text: 'vitePress使用', 
        items: [
          { text: '主题配置', link: '/useVitePress/themeConfig' },
        ] 
      },
    ],

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    lastUpdatedText: '上次更新',
  },
})
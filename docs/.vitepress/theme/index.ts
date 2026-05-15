import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'

import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

export default {
	...DefaultTheme,
	Layout
	,
	enhanceApp(ctx) {
		DefaultTheme.enhanceApp?.(ctx)
		ctx.app.use(ElementPlus)
	}
}

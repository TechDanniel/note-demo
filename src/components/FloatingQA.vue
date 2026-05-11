<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import type { Match } from '../types/floatingQA'
import { buildPrompt, chat, createFloatingQaEnv, createFloatingQaService } from '../utils/floatingQA'

const state = reactive({
    open: false,
    question: '',
    answer: '',
    loading: false,
    useLocalKb: false,
    status: ''
})

const env = createFloatingQaEnv()

const canCallAi = computed(() => Boolean(env.apiKey && env.baseUrl))

const service = createFloatingQaService({
    env,
    setStatus: (text) => {
        state.status = text
    }
})

async function ask() {
    state.answer = ''
    state.status = ''

    const q = state.question.trim()
    if (!q) return
    if (!canCallAi.value) {
        state.status = '缺少 VITE_OPENAI_API_KEY 或 VITE_OPENAI_BASE_URL'
        return
    }

    state.loading = true
    try {
        let matches: Match[] = []
        if (state.useLocalKb) {
            await service.initKbOnce()
            matches = await service.searchKb(q, 5)
        }
        const prompt = buildPrompt(q, matches)
        state.answer = await chat(env, prompt)
    } catch (e: any) {
        state.status = e?.message ?? String(e)
    } finally {
        state.loading = false
    }
}

watch(
    () => state.useLocalKb,
    (enabled: boolean) => {
        if (!enabled) return
        service.initKbOnce().catch((e) => {
            state.status = e?.message ?? String(e)
        })
    }
)

onBeforeUnmount(() => {
    service.dispose()
})
</script>

<template>
    <div class="floating-qa">
        <button class="fab" @click="state.open = !state.open">AI</button>
        <div v-if="state.open" class="panel">
            <div class="row header">
                <div class="title">问答</div>
                <button class="close" @click="state.open = false">×</button>
            </div>

            <label class="row toggle">
                <input type="checkbox" v-model="state.useLocalKb" />
                <span>使用本地知识库</span>
            </label>

            <textarea v-model="state.question" class="input" rows="4" placeholder="输入你的问题..." />

            <div class="row actions">
                <button class="primary" :disabled="state.loading" @click="ask">
                    {{ state.loading ? '处理中...' : '发送' }}
                </button>
                <button class="ghost" :disabled="state.loading" @click="state.question = ''">清空</button>
            </div>

            <div v-if="state.status" class="status">{{ state.status }}</div>
            <pre v-if="state.answer" class="answer">{{ state.answer }}</pre>
        </div>
    </div>
</template>

<style scoped>
.floating-qa {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 9999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

.fab {
    width: 48px;
    height: 48px;
    border-radius: 999px;
    border: 1px solid #ddd;
    background: #fff;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.panel {
    margin-top: 10px;
    width: 360px;
    max-width: calc(100vw - 32px);
    background: #fff;
    color: #111;
    color-scheme: light;
    border: 1px solid #eee;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    padding: 12px;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.header {
    justify-content: space-between;
    margin-bottom: 8px;
}

.title {
    font-weight: 600;
}

.close {
    border: none;
    background: transparent;
    color: #111;
    font-size: 18px;
    cursor: pointer;
}

.toggle {
    margin: 6px 0 10px;
    user-select: none;
}

.input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid #ddd;
    background: #fff;
    color: #111;
    resize: vertical;
}

.input::placeholder {
    color: #666;
}

.actions {
    margin-top: 10px;
    justify-content: flex-end;
}

.primary {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #111;
    background: #111;
    color: #fff;
    cursor: pointer;
}

.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.ghost {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #ddd;
    background: #fff;
    cursor: pointer;
}

.status {
    margin-top: 10px;
    font-size: 12px;
    color: #b42318;
    white-space: pre-wrap;
}

.answer {
    margin-top: 10px;
    padding: 10px;
    border-radius: 8px;
    background: #fafafa;
    border: 1px solid #eee;
    white-space: pre-wrap;
    max-height: 240px;
    overflow: auto;
}
</style>

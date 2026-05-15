<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  ElButton,
  ElDrawer,
  ElInput,
  ElScrollbar,
  ElSwitch
} from 'element-plus'
import type { InputInstance } from 'element-plus'
import { Promotion } from '@element-plus/icons-vue'

import type { Match, AskOptions, UiChatMessage } from '../types/floatingQA'
import Robot from '../assets/robot.png'
import { buildPrompt, chat, createFloatingQaEnv, createFloatingQaService } from '../utils/floatingQA'
import {
  deleteThread,
  getOrCreateThread,
  listMessages,
  updateMessage
} from '../utils/chatDb'
import { useDrag } from '../utils/useDrag'
import MarkdownIt from 'markdown-it'
import {
  handleAsk,
  createThrottled,
  scrollToBottom,
  quickPrompts,
  buildChatHistory,
  createDebouncedPersist,
  getAssistantMessage
} from '../utils/renderQA'

const state = reactive({
  open: false,
  question: '',
  loading: false,
  useLocalKb: false,
  status: ''
})

const CURRENT_THREAD_ID_KEY = 'kb_chat_current_thread_id'

const currentThreadId = ref<string>('')
const messages = ref<UiChatMessage[]>([])

const scrollbarRef = ref<any>()

const md = new MarkdownIt({
  breaks: true,
  linkify: true
})

function renderMarkdown(raw: string) {
  return md.render(raw ?? '')
}

async function loadConversation(options?: { force?: boolean }) {
  if (!options?.force) {
    if (currentThreadId.value && messages.value.length) return
  }

  state.status = ''
  try {
    const savedId = localStorage.getItem(CURRENT_THREAD_ID_KEY) ?? undefined
    const thread = await getOrCreateThread(savedId)
    currentThreadId.value = thread.id
    localStorage.setItem(CURRENT_THREAD_ID_KEY, thread.id)
    const loaded = await listMessages(thread.id)
    messages.value = loaded.map((m) => {
      if (m.role === 'assistant' || m.role === 'system') {
        return { ...m, renderedHtml: renderMarkdown(m.content) }
      }
      return m
    })
    await nextTick()
    scrollToBottom(scrollbarRef)
  } catch (e: any) {
    state.status = e?.message ?? String(e)
    currentThreadId.value = ''
    messages.value = []
  }
}

async function clearConversation() {
  state.status = ''
  if (state.loading) return

  const oldId = currentThreadId.value || localStorage.getItem(CURRENT_THREAD_ID_KEY) || ''
  currentThreadId.value = ''
  messages.value = []
  localStorage.removeItem(CURRENT_THREAD_ID_KEY)

  if (oldId) {
    try {
      await deleteThread(oldId)
    } catch (e: any) {
      state.status = e?.message ?? String(e)
    }
  }

  await loadConversation({ force: true })
  await nextTick(() => inputRef.value?.focus())
}

// robot移动
const robotBtn = ref<HTMLElement | null>(null)
const { onPointerDown, bottomPosition, suppressNextClick } = useDrag(robotBtn)

function handleRobotClick(e: MouseEvent) {
  if (suppressNextClick.value) {
    suppressNextClick.value = false
    e.preventDefault()
    e.stopPropagation()
    return
  }
  state.open = true
}

const env = createFloatingQaEnv()
const canCallAi = computed(() => Boolean(env.apiKey && env.chatModel))
const canSend = computed(() => Boolean(state.question.trim()) && !state.loading && canCallAi.value)

const service = createFloatingQaService({
  env,
  setStatus: (text) => {
    state.status = text
  }
})

const inputRef = ref<InputInstance>()

const hasChatContent = computed(() => state.loading || messages.value.length > 0)

const sendColor = computed(() => {
  if (!state.question.trim()) return 'var(--qa-muted)'
  if (state.loading) return 'var(--qa-muted)'
  if (!canCallAi.value) return 'var(--qa-muted)'
  return 'var(--vp-c-primary, #3b82f6)'
})

function applyQuickPrompt(text: string) {
  state.question = text
  nextTick(() => inputRef.value?.focus())
}

async function searchLocalKbIfEnabled(q: string) {
  if (!state.useLocalKb) return [] as Match[]
  await service.initKbOnce()
  return service.searchKb(q, 5)
}

function createChatRunners(options: AskOptions) {
  const scheduleRender = createThrottled(() => {
    const msg = getAssistantMessage(options, messages)
    if (!msg) return
    msg.renderedHtml = renderMarkdown(msg.content)
  }, 120)

  const persister = createDebouncedPersist(options, messages, 1000)

  return { scheduleRender, persister }
}

async function ask() {
  state.status = ''

  if (!canCallAi.value) {
    state.status = '缺少 VITE_OPENROUTER_API_KEY 或 VITE_OPENROUTER_MODEL'
    return
  }

  const q = state.question.trim()
  if (!q) return

  await loadConversation()
  const threadId = currentThreadId.value

  const history = buildChatHistory(messages.value, 20)

  state.loading = true
  state.question = ''

  const options: AskOptions = {
    assistantMessageId: null,
    assistantIdx: -1,
    assistantRaw: ''
  }

  try {
    await handleAsk(threadId, q, messages, options)
    await nextTick()
    scrollToBottom(scrollbarRef)

    const matches = await searchLocalKbIfEnabled(q)
    const prompt = buildPrompt(q, matches)

    const { scheduleRender, persister } = createChatRunners(options)

    const full = await chat(env, prompt, {
      history,
      onDelta: (delta) => {
        const msg = getAssistantMessage(options, messages)
        if (!msg) return
        options.assistantRaw += delta
        msg.content = options.assistantRaw
        msg.updatedAt = Date.now()
        scheduleRender()
        persister.schedule()
        scrollToBottom(scrollbarRef)
      }
    })

    {
      const msg = getAssistantMessage(options, messages)
      if (msg) {
        msg.content = full
        msg.renderedHtml = renderMarkdown(full)
        await persister.flush()
        msg.status = 'done'
        msg.updatedAt = Date.now()
      }
    }

    if (threadId && options.assistantMessageId) {
      await updateMessage(options.assistantMessageId, { content: full, status: 'done' }).catch(() => { })
    }
  } catch (e: any) {
    const msg = getAssistantMessage(options, messages)
    const errText = e?.message ?? String(e)
    state.status = errText
    if (msg) {
      msg.status = 'error'
      if (!msg.content.trim()) {
        msg.content = `发生错误：${errText}`
      }
      msg.renderedHtml = renderMarkdown(msg.content)
      msg.updatedAt = Date.now()
      if (threadId && options.assistantMessageId) {
        await updateMessage(options.assistantMessageId, { content: msg.content, status: 'error' }).catch(() => { })
      }
    }
  } finally {
    state.loading = false
    await nextTick()
    scrollToBottom(scrollbarRef)
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

watch(
  () => state.open,
  (opened) => {
    if (!opened) return
    loadConversation().finally(() => {
      nextTick(() => inputRef.value?.focus())
    })
  }
)
</script>

<template>
  <div class="qa-root">
    <button v-if="!state.open" ref="robotBtn" type="button" class="qa-fab"
      :style="{ position: 'fixed', bottom: bottomPosition + 'px', right: 0 }" @click="handleRobotClick"
      @pointerdown="onPointerDown">
      <img :src="Robot" width="100%" height="100%" aria-hidden="true" />
    </button>

    <ElDrawer v-model="state.open" direction="rtl" :with-header="false" :append-to-body="true" :modal="false"
      :lock-scroll="false" size="420" resizable class="qa-drawer">
      <div class="qa-drawer-inner">
        <header class="qa-header">
          <div class="qa-title">
            <div class="qa-title-main">AI 问答</div>
          </div>
          <div class="qa-actions">
            <el-tooltip content="清空后将以“无记忆”方式重新开始对话" placement="bottom-end">
              <ElButton text class="qa-clear" size="small" :disabled="state.loading" @click="clearConversation">
                清空
              </ElButton>
            </el-tooltip>
            <ElButton text class="qa-close" @click="state.open = false" aria-label="关闭">
              ×
            </ElButton>
          </div>
        </header>

        <div class="qa-body">
          <div class="qa-area">
            <ElInput ref="inputRef" v-model="state.question" type="textarea" input-style="height:120px"
              :disabled="state.loading" placeholder="输入您的问题" />
            <ElButton class="send_icon" :loading="state.loading" :disabled="!canSend" @click="ask">
              <el-icon :color="sendColor">
                <Promotion />
              </el-icon>
            </ElButton>
          </div>

          <div v-if="state.status" class="qa-status" role="status" aria-live="polite">{{ state.status }}</div>

          <div class="qa-toggle">
            <el-tooltip content="开启后会先检索本站文档片段再回答" placement="top-start">
              <div class="qa-toggle-title">使用本地知识库</div>
            </el-tooltip>
            <ElSwitch v-model="state.useLocalKb" :disabled="state.loading" />
          </div>

          <div class="qa-answer-wrap" :class="{ 'qa-answer-empty': !hasChatContent }" aria-label="对话区域">
            <template v-if="hasChatContent">
              <ElScrollbar ref="scrollbarRef" class="qa-scrollbar">
                <div class="qa-messages">
                  <div v-for="m in messages" :key="m.id" class="qa-msg" :class="{
                    'qa-msg-user': m.role === 'user',
                    'qa-msg-assistant': m.role === 'assistant',
                    'qa-msg-system': m.role === 'system'
                  }">
                    <div class="qa-bubble" :class="{
                      'qa-bubble-user': m.role === 'user',
                      'qa-bubble-assistant': m.role === 'assistant',
                      'qa-bubble-system': m.role === 'system'
                    }">
                      <div v-if="m.role === 'assistant' && m.status === 'streaming' && !m.content"
                        class="qa-bubble-text qa-bubble-muted">正在生成回答…</div>
                      <div v-else-if="m.role === 'user'" class="qa-bubble-text">{{ m.content }}</div>
                      <div v-else class="qa-bubble-text" v-html="m.renderedHtml"></div>
                    </div>
                  </div>
                </div>
              </ElScrollbar>
            </template>
            <div v-else class="qa-empty">
              <div class="qa-greeting">
                <div class="qa-greeting-title">你好！我是 AI 助手</div>
                <div class="qa-greeting-sub">可以先试试下面的快捷提问，或在下方输入你的问题。</div>
              </div>
              <div class="qa-chips qa-chips-center">
                <ElButton v-for="p in quickPrompts" :key="p" class="qa-chip" plain size="small"
                  :disabled="state.loading" @click="applyQuickPrompt(p)">
                  {{ p }}
                </ElButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ElDrawer>
  </div>
</template>

<style scoped>
.qa-root {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  /* Prefer VitePress theme tokens when available */
  --qa-bg: var(--vp-c-bg-elv, var(--vp-c-bg-soft, #f8fafc));
  --qa-surface: var(--vp-c-bg, #ffffff);
  --qa-text: var(--vp-c-text-1, #0f172a);
  --qa-muted: var(--vp-c-text-2, #64748b);
  --qa-border: var(--vp-c-divider, #e2e8f0);
  --qa-border-soft: var(--vp-c-divider-light, #eef2f7);
  --qa-accent-ring: rgba(2, 132, 199, 0.28);
  --qa-shadow: 0 22px 60px rgba(2, 6, 23, 0.14);
  --qa-shadow-sm: 0 10px 22px rgba(2, 6, 23, 0.08);
}

:global(.dark) .qa-root {
  --qa-bg: var(--vp-c-bg-elv, var(--vp-c-bg-soft, rgba(2, 6, 23, 0.35)));
  --qa-surface: var(--vp-c-bg, #0b1220);
  --qa-text: var(--vp-c-text-1, #e2e8f0);
  --qa-muted: var(--vp-c-text-2, #94a3b8);
  --qa-border: var(--vp-c-divider, #1f2a44);
  --qa-border-soft: var(--vp-c-divider-light, rgba(148, 163, 184, 0.16));
  --qa-accent-ring: rgba(56, 189, 248, 0.25);
  --qa-shadow: 0 22px 60px rgba(0, 0, 0, 0.5);
  --qa-shadow-sm: 0 10px 22px rgba(0, 0, 0, 0.35);
}

.qa-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.qa-fab {
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  border: 1px solid var(--qa-border);
  background: var(--qa-bg);
  color: var(--qa-text);
  box-shadow: var(--qa-shadow-sm);
  cursor: pointer;
  user-select: none;
  transition: transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease, border-color 150ms ease;
}

.qa-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(2, 6, 23, 0.14);
}

.qa-fab:active {
  transform: translateY(0);
  box-shadow: 0 8px 18px rgba(2, 6, 23, 0.12);
}

.qa-fab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--qa-accent-ring), var(--qa-shadow-sm);
}

/* Drawer overrides */
.qa-drawer :deep(.el-drawer) {
  background: transparent;
}

.qa-drawer :deep(.el-drawer__body) {
  padding: 0;
}

.qa-drawer-inner {
  position: relative;
  height: 100%;
  border-left: 1px solid var(--qa-border);
  background: var(--qa-bg);
  color: var(--qa-text);
  box-shadow: var(--qa-shadow);
  display: flex;
  flex-direction: column;
}

.qa-body {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column-reverse;
  gap: 5px;
  position: relative;
  height: 100%;
}

.qa-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: ew-resize;
}

.qa-resize-handle::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 16px;
  bottom: 16px;
  width: 2px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--qa-muted) 35%, transparent);
  opacity: 0.75;
  transition: opacity 150ms ease, background-color 150ms ease;
}

.qa-resize-handle:hover::after {
  opacity: 1;
  background: color-mix(in srgb, var(--qa-muted) 55%, transparent);
}

.qa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--qa-border-soft);
}

.qa-title {
  min-width: 0;
}

.qa-title-main {
  font-size: 20px;
  font-weight: 700;
  line-height: 20px;
}

.qa-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qa-close {
  font-size: 18px;
  line-height: 1;
}

.qa-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qa-status {
  padding: 8px 10px;
  border-radius: 14px;
  border: 1px solid var(--qa-border-soft);
  background: color-mix(in srgb, var(--qa-surface) 70%, transparent);
  font-size: 12px;
  line-height: 16px;
  color: var(--qa-muted);
  white-space: pre-wrap;
  max-height: 120px;
  overflow: auto;
}

.send_icon {
  position: absolute;
  right: 5px;
  bottom: 5px;
}

.qa-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.qa-chips-center {
  justify-content: center;
}

.qa-chip {
  max-width: 100%;
}

.qa-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 16px;
  border: 1px solid var(--qa-border);
  background: color-mix(in srgb, var(--qa-surface) 70%, transparent);
}

.qa-toggle-title {
  font-size: 13px;
  font-weight: 650;
}

.qa-toggle-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 16px;
  color: var(--qa-muted);
}

.qa-answer-wrap {
  min-height: 180px;
  border-radius: 16px;
  border: 1px solid var(--qa-border);
  background: var(--qa-surface);
  flex: 1;
}

.qa-answer-empty {
  display: flex;
}

.qa-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 14px;
  text-align: center;
}

.qa-greeting {
  max-width: 320px;
}

.qa-greeting-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 20px;
  color: var(--qa-text);
}

.qa-greeting-sub {
  margin-top: 6px;
  font-size: 13px;
  line-height: 18px;
  color: var(--qa-muted);
}

.qa-scrollbar {
  min-height: 180px;
}

.qa-messages {
  padding: 10px 10px 10px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qa-msg {
  display: flex;
}

.qa-msg-user {
  justify-content: flex-end;
}

.qa-msg-assistant {
  justify-content: flex-start;
}

.qa-msg-system {
  justify-content: center;
}

.qa-bubble {
  max-width: 88%;
  border-radius: 14px;
  padding: 8px 10px;
  border: 1px solid var(--qa-border-soft);
}

.qa-bubble-user {
  background: color-mix(in srgb, var(--qa-bg) 80%, var(--qa-surface));
}

.qa-bubble-assistant {
  background: color-mix(in srgb, var(--qa-surface) 85%, transparent);
}

.qa-bubble-system {
  background: color-mix(in srgb, var(--qa-surface) 70%, transparent);
}

.qa-bubble-text {
  margin: 0;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 18px;
  color: var(--qa-text);
}

.qa-bubble-text :deep(p),
.qa-bubble-text :deep(pre) {
  margin: 0;
}

.qa-bubble-muted {
  color: var(--qa-muted);
}

@media (max-width: 420px) {
  .qa-root {
    right: 12px;
    bottom: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {

  .qa-fab,
  .qa-resize-handle::after {
    transition: none !important;
  }
}
</style>

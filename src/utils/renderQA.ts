import { type Ref } from 'vue'
import type { ScrollbarInstance } from 'element-plus';
import { addMessage, updateMessage } from './chatDb'
import type{ UiChatMessage,AskOptions } from '../types/floatingQA'

// 创建message ID
export function createLocalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

// 滚动到对话最底部
export function scrollToBottom(scrollbarRef: Ref<ScrollbarInstance | null | undefined>) {
  const api = scrollbarRef.value
  try {
    api?.setScrollTop?.(Number.MAX_SAFE_INTEGER)
    const wrap = api?.wrapRef as HTMLElement | undefined
    // 滚动到最底部scrollTop = scrollHeight - clientHeight，但浏览器会自动限制，不会滚出内容区域，所以会滚动到底部
    wrap?.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' })
  } catch {
    // ignore
  }
}

export const quickPrompts = [
  '这份知识库怎么开始使用？',
  '如何新增一篇文档并生成目录？',
  '本地知识库开关有什么影响？'
]

export function createThrottled(fn: () => void, waitMs: number) {
  let timer: number | undefined
  return () => {
    if (timer) return
    timer = window.setTimeout(() => {
      timer = undefined
      fn()
    }, waitMs)
  }
}

export function buildChatHistory(messages: UiChatMessage[], limit = 20) {
  return messages
    .slice(-limit)
    .filter((m) => Boolean(m.content?.trim()))
    .map((m) => ({ role: m.role as any, content: m.content }))
}

// 问答预处理：1.渲染用户消息 2.流式消息预站位 3.返回AI流式回答更新定时器
export async function handleAsk(threadId: string | null, q: string, messages:Ref<UiChatMessage[]>, options:AskOptions) {
  const now = Date.now()
  
  // 1) 持久化 + 渲染用户消息
  try {
    if (threadId) {
      const saved = await addMessage({ threadId, role: 'user', content: q })
      messages.value.push(saved)
    } else {
      throw new Error('thread 未初始化')
    }
  } catch {
    messages.value.push({
      id: createLocalId(),
      threadId: threadId || 'local',
      role: 'user',
      content: q,
      createdAt: now,
      updatedAt: now
    })
  }

  // 2) assistant 占位消息（用于流式更新）
  try {
    if (threadId) {
      const saved = await addMessage({ threadId, role: 'assistant', content: '', status: 'streaming' })
      options.assistantMessageId = saved.id
      messages.value.push({ ...saved, renderedHtml: '' })
    } else {
      throw new Error('thread 未初始化')
    }
  } catch {
    const local: UiChatMessage = {
      id: createLocalId(),
      threadId: threadId || 'local',
      role: 'assistant',
      content: '',
      renderedHtml: '',
      status: 'streaming',
      createdAt: now,
      updatedAt: now
    }
    options.assistantMessageId = null
    messages.value.push(local)
  }

  options.assistantIdx = messages.value.length - 1
}

export function getAssistantMessage(options: AskOptions,messages: Ref<UiChatMessage[]>) {
  const idx = options.assistantIdx
  if (idx < 0) return null
  return messages.value[idx] ?? null
} 

export function createDebouncedPersist(options: AskOptions,messages: Ref<UiChatMessage[]>, waitMs = 1000) {
  let timer: number | undefined
  let inFlight = false
  let dirty = false

  const runOnce = async () => {
    if (!options.assistantMessageId) return
    const msg = getAssistantMessage(options, messages)
    if (!msg) return

    if (inFlight) {
      // 如果上一次更新还在进行中，标记为 dirty，等上一次完成后再追一次最新内容
      dirty = true
      return
    }

    // 标记异步任务正在进行中，避免重复触发
    inFlight = true
    try {
      await updateMessage(options.assistantMessageId, {
        content: msg.content,
        status: msg.status
      }).catch(() => {})
    } finally {
      inFlight = false
    }

    if (dirty) {
      dirty = false
      schedule() // 追一次最新内容
    }
  }

  const schedule = () => {
    if (!options.assistantMessageId) return
    dirty = true
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      dirty = false
      void runOnce()
    }, waitMs)
  }

  const flush = async () => {
    if (timer) {
      window.clearTimeout(timer)
      timer = undefined
    }
    dirty = false
    await runOnce()
  }

  const cancel = () => {
    if (timer) {
      window.clearTimeout(timer)
      timer = undefined
    }
    dirty = false
  }

  return { schedule, flush, cancel }
}
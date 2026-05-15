import type { ChatMessage, ChatThread, ChatMessageStatus, ChatRole } from '@/types/floatingQA'

const DB_NAME = 'kb-chat'
const DB_VERSION = 1

const STORE_THREADS = 'threads'
const STORE_MESSAGES = 'messages'

const IDX_MESSAGES_BY_THREAD_CREATED_AT = 'byThreadCreatedAt'

function createId() {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID()
	}
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
	})
}

function txDone(tx: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
	})
}

let dbPromise: Promise<IDBDatabase> | null = null

export function openChatDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('当前环境不支持 IndexedDB'))
	}

	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result

      // 创建会话表
			if (!db.objectStoreNames.contains(STORE_THREADS)) {
				db.createObjectStore(STORE_THREADS, { keyPath: 'id' })
			}
      // 创建消息表，并建立基于 threadId 和 createdAt 的复合索引，便于按会话查询消息。
			if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
				const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' })
				store.createIndex(IDX_MESSAGES_BY_THREAD_CREATED_AT, ['threadId', 'createdAt'], {
					unique: false
				})
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'))
	})

	return dbPromise
}

export async function getOrCreateThread(threadId?: string): Promise<ChatThread> {
	const db = await openChatDb()
	const id = threadId ?? createId()

  // tranction创建STORE_THREADS表的读写事务，并获取store对象用于后续对表的操作
	const tx = db.transaction([STORE_THREADS], 'readwrite')
	const store = tx.objectStore(STORE_THREADS)

  // 获取指定id的thread会话
	const existing = await requestToPromise<ChatThread | undefined>(store.get(id) as IDBRequest)
	if (existing) {
		existing.updatedAt = Date.now() // 更新会话的更新时间戳
		store.put(existing) // 将更新后的会话对象存回数据库
		await txDone(tx) // 等待事务完成，写操作必须等待完成后才能继续
		return existing
	}

	const now = Date.now()
	const created: ChatThread = { id, createdAt: now, updatedAt: now }
	store.add(created)
	await txDone(tx)
	return created
}

export async function listMessages(threadId: string, options?: { limit?: number }): Promise<ChatMessage[]> {
	const db = await openChatDb()
	const limit = options?.limit

	const tx = db.transaction([STORE_MESSAGES], 'readonly')
	const store = tx.objectStore(STORE_MESSAGES)
	const idx = store.index(IDX_MESSAGES_BY_THREAD_CREATED_AT)

  // 明确查询范围为指定 threadId 的所有消息，且按照 createdAt 升序排序
	const range = IDBKeyRange.bound([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER])
	const messages: ChatMessage[] = []

	await new Promise<void>((resolve, reject) => {
    // 使用游标根据索引的范围查询消息，next表示根据索引升序
		const cursorReq = idx.openCursor(range, 'next')
		cursorReq.onerror = () => reject(cursorReq.error ?? new Error('读取消息失败'))
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result
			if (!cursor) {
				resolve()
				return
			}
			messages.push(cursor.value as ChatMessage)
			if (typeof limit === 'number' && messages.length >= limit) {
				resolve()
				return
			}
			cursor.continue()
		}
	})

	await txDone(tx)
	return messages
}

export async function addMessage(input: {
	threadId: string
	role: ChatRole
	content: string
	status?: ChatMessageStatus
	id?: string
	createdAt?: number
}): Promise<ChatMessage> {
	const db = await openChatDb()
	const now = Date.now()

	const msg: ChatMessage = {
		id: input.id ?? createId(),
		threadId: input.threadId,
		role: input.role,
		content: input.content,
		status: input.status,
		createdAt: input.createdAt ?? now,
		updatedAt: now
	}

	const tx = db.transaction([STORE_MESSAGES, STORE_THREADS], 'readwrite')
	tx.objectStore(STORE_MESSAGES).add(msg)

	const threads = tx.objectStore(STORE_THREADS)
	const tReq = threads.get(input.threadId)
	tReq.onsuccess = () => {
		const thread = tReq.result as ChatThread | undefined
		if (thread) {
			thread.updatedAt = now
			threads.put(thread)
		}
	}

	await txDone(tx)
	return msg
}

export async function updateMessage(messageId: string, patch: Partial<Pick<ChatMessage, 'content' | 'status'>>): Promise<void> {
	const db = await openChatDb()
	const tx = db.transaction([STORE_MESSAGES], 'readwrite')
	const store = tx.objectStore(STORE_MESSAGES)

	const existing = await requestToPromise<ChatMessage | undefined>(store.get(messageId) as IDBRequest)
	if (!existing) {
		await txDone(tx)
		return
	}

	const updated: ChatMessage = {
		...existing,
		...patch,
		updatedAt: Date.now()
	}
	store.put(updated)
	await txDone(tx)
}

export async function clearThreadMessages(threadId: string): Promise<void> {
	const db = await openChatDb()
	const tx = db.transaction([STORE_MESSAGES], 'readwrite')
	const store = tx.objectStore(STORE_MESSAGES)
	const idx = store.index(IDX_MESSAGES_BY_THREAD_CREATED_AT)

	const range = IDBKeyRange.bound([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER])

	await new Promise<void>((resolve, reject) => {
		const cursorReq = idx.openCursor(range, 'next')
		cursorReq.onerror = () => reject(cursorReq.error ?? new Error('清空消息失败'))
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result
			if (!cursor) {
				resolve()
				return
			}
			cursor.delete()
			cursor.continue()
		}
	})

	await txDone(tx)
}

export async function deleteThread(threadId: string): Promise<void> {
	const db = await openChatDb()
	const tx = db.transaction([STORE_THREADS, STORE_MESSAGES], 'readwrite')

	tx.objectStore(STORE_THREADS).delete(threadId)
	const store = tx.objectStore(STORE_MESSAGES)
	const idx = store.index(IDX_MESSAGES_BY_THREAD_CREATED_AT)
	const range = IDBKeyRange.bound([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER])

	await new Promise<void>((resolve, reject) => {
		const cursorReq = idx.openCursor(range, 'next')
		cursorReq.onerror = () => reject(cursorReq.error ?? new Error('删除会话消息失败'))
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result
			if (!cursor) {
				resolve()
				return
			}
			cursor.delete()
			cursor.continue()
		}
	})

	await txDone(tx)
}

import type { Match, WorkerMsg } from '../types/floatingQA'

export type FloatingQaEnv = {
	apiKey?: string
	baseUrl?: string
	chatModel: string
	embeddingProvider: 'openai-compatible' | 'local'
	embeddingModel: string
	localEmbeddingModel: string
	kbManifestUrl: string
	kbVectorsUrl: string
}

export function getBaseUrl() {
	const base = (import.meta.env.BASE_URL as string | undefined) ?? '/'
	return base.endsWith('/') ? base : `${base}/`
}

export function createFloatingQaEnv(): FloatingQaEnv {
	const embeddingProviderRaw = (import.meta.env.VITE_EMBEDDING_PROVIDER as string | undefined) ?? 'openai-compatible'
	const embeddingProvider = embeddingProviderRaw === 'local' ? 'local' : 'openai-compatible'
	const localEmbeddingModel =
		(import.meta.env.VITE_LOCAL_EMBEDDING_MODEL as string | undefined) ?? 'Xenova/all-MiniLM-L6-v2'

	return {
		apiKey: import.meta.env.VITE_OPENAI_API_KEY as string | undefined,
		baseUrl: import.meta.env.VITE_OPENAI_BASE_URL as string | undefined,
		chatModel: (import.meta.env.VITE_OPENAI_MODEL as string | undefined) ?? 'gpt-5.3-codex',
		embeddingProvider,
		embeddingModel:
			(import.meta.env.VITE_OPENAI_EMBEDDING_MODEL as string | undefined) ?? 'text-embedding-3-small',
		localEmbeddingModel,
		kbManifestUrl:
			(import.meta.env.VITE_KB_MANIFEST_URL as string | undefined) ?? `${getBaseUrl()}kb/manifest.json`,
		kbVectorsUrl:
			(import.meta.env.VITE_KB_VECTORS_URL as string | undefined) ?? `${getBaseUrl()}kb/vectors.bin`
	}
}

export function buildPrompt(question: string, matches: Match[]) {
	if (!matches.length) {
		return `问题：${question}`
	}
	const ctx = matches
		.map((m, idx) => {
			const title = `[${idx + 1}] ${m.chunk.sourcePath} (score=${m.score.toFixed(4)})`
			return `${title}\n${m.chunk.text}`
		})
		.join('\n\n')

	return `本地知识库检索到以下片段（可能不完整/可能与问题无关）：\n\n${ctx}\n\n用户问题：${question}`
}

async function probeJson(url: string) {
	const res = await fetch(url, { cache: 'no-store' })
	if (!res.ok) {
		throw new Error(`加载失败：${url} (${res.status})`)
	}
	try {
		await res.json()
	} catch {
		throw new Error(`manifest 不是有效 JSON：${url}`)
	}
}

async function probeBinary(url: string) {
	// 尽量避免下载完整 vectors.bin：优先 HEAD；不支持则用 Range GET。
	try {
		const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
		if (head.ok) return
		// 某些静态服务可能不支持 HEAD（405/501），继续 fallback。
		if (![405, 501].includes(head.status)) {
			throw new Error(`加载失败：${url} (${head.status})`)
		}
	} catch {
		// ignore and fallback
	}

	const controller = new AbortController()
	const res = await fetch(url, {
		method: 'GET',
		headers: {
			Range: 'bytes=0-0'
		},
		cache: 'no-store',
		signal: controller.signal
	})
	if (!(res.ok || res.status === 206)) {
		throw new Error(`加载失败：${url} (${res.status})`)
	}
	try {
		// 主动取消 body流的下载，避免拉取大文件
		await res.body?.cancel()
	} catch {
		// ignore
	}
	controller.abort()
}

function kbMissingHint(env: FloatingQaEnv) {
	return [
		'未检测到本地知识库文件（manifest/vectors）。',
		`manifest: ${env.kbManifestUrl}`,
		`vectors:  ${env.kbVectorsUrl}`,
		'',
		'请先用 CLI 生成并放到站点可访问的位置（VitePress 通常是 note-demo/docs/public/kb）：',
		'  knowledge-base ai index --input <你的md或目录> --out note-demo/docs/public/kb',
		'',
		'或通过 .env 配置覆盖：VITE_KB_MANIFEST_URL / VITE_KB_VECTORS_URL。'
	].join('\n')
}

export async function chat(env: FloatingQaEnv, prompt: string) {
	if (!env.apiKey) throw new Error('缺少 VITE_OPENAI_API_KEY')
	if (!env.baseUrl) throw new Error('缺少 VITE_OPENAI_BASE_URL')
	const baseUrl = env.baseUrl.replace(/\/$/, '')

	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.apiKey}`
		},
		body: JSON.stringify({
			model: env.chatModel,
			messages: [
				{
					role: 'system',
					content:
						'你是一个严谨的知识库问答助手。优先基于给定的上下文回答；如果上下文不足以支持结论，请明确说明无法从知识库得出答案。'
				},
				{ role: 'user', content: prompt }
			],
			temperature: 0.2,
			max_tokens: 1024
		})
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Chat 请求失败：${res.status} ${text}`)
	}

	const json: any = await res.json()
	const content = json?.choices?.[0]?.message?.content?.trim()
	if (!content) throw new Error('Chat 返回为空')
	return content as string
}

export type FloatingQaService = {
	initKbOnce(): Promise<void>
	searchKb(query: string, topK?: number): Promise<Match[]>
	dispose(): void
}

export function createFloatingQaService(options: {
	env: FloatingQaEnv
	setStatus?: (text: string) => void
}): FloatingQaService {
	const setStatus = options.setStatus
	let worker: Worker | null = null
	let workerInited = false

	let initPromise: Promise<void> | null = null
	let initResolve: (() => void) | null = null
	let initReject: ((e: Error) => void) | null = null

	let pendingSearchResolve: ((m: Match[]) => void) | null = null
	let pendingSearchReject: ((e: Error) => void) | null = null

	function ensureWorker() {
		if (worker) return
		worker = new Worker(new URL('../workers/kb.worker.ts', import.meta.url), { type: 'module' })
		worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
			const msg = ev.data
			if (msg.type === 'inited') {
				workerInited = true
				setStatus?.(`本地知识库已加载：${msg.chunkCount} chunks (dim=${msg.dimension})`)
				initResolve?.()
				initResolve = null
				initReject = null
				initPromise = null
				return
			}
			if (msg.type === 'searchResult') {
				pendingSearchResolve?.(msg.matches)
				pendingSearchResolve = null
				pendingSearchReject = null
				return
			}
			if (msg.type === 'error') {
				setStatus?.(msg.message)
				const err = new Error(msg.message)
				initReject?.(err)
				initResolve = null
				initReject = null
				initPromise = null

				pendingSearchReject?.(err)
				pendingSearchResolve = null
				pendingSearchReject = null
				return
			}
		}
	}

	function initKbOnce(): Promise<void> {
		ensureWorker()
		if (!worker) return Promise.reject(new Error('Worker 未初始化'))
		if (workerInited) return Promise.resolve()
		if (initPromise) return initPromise

		setStatus?.('正在检查本地知识库文件...')
		const p = new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void) => {
			initResolve = resolve
			initReject = (e: Error) => reject(e)
			;(async () => {
				try {
					await probeJson(options.env.kbManifestUrl)
					await probeBinary(options.env.kbVectorsUrl)
				} catch (e: any) {
					throw new Error(`${kbMissingHint(options.env)}\n\n原始错误：${e?.message ?? String(e)}`)
				}

				setStatus?.('正在加载本地知识库...')
				worker!.postMessage({
					type: 'init',
					manifestUrl: options.env.kbManifestUrl,
					vectorsUrl: options.env.kbVectorsUrl
				})
			})().catch((e: any) => {
				const err = e instanceof Error ? e : new Error(String(e))
				initReject?.(err)
				initResolve = null
				initReject = null
				initPromise = null
			})
		})
		initPromise = p
		return p
	}

	function searchKb(query: string, topK = 5): Promise<Match[]> {
		if (!worker) throw new Error('Worker 未初始化')
		if (options.env.embeddingProvider === 'openai-compatible' && !options.env.apiKey) {
			throw new Error('缺少 VITE_OPENAI_API_KEY（远端 embedding 需要）')
		}
		return new Promise<Match[]>((resolve: (m: Match[]) => void, reject: (e: Error) => void) => {
			pendingSearchResolve = resolve
			pendingSearchReject = reject
			worker!.postMessage({
				type: 'search',
				query,
				topK,
				embedding:
					{
                        provider: 'local',
                        model: options.env.localEmbeddingModel
                    }
			})
		})
	}

	function dispose() {
		worker?.terminate()
		worker = null
		workerInited = false
		initPromise = null
		initResolve = null
		initReject = null
		pendingSearchResolve = null
		pendingSearchReject = null
	}

	return {
		initKbOnce,
		searchKb,
		dispose
	}
}

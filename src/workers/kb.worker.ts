import type { KbManifest, KbWorkerIncomingMessage, KbWorkerSearchMessage } from '../types/workers'

let manifest: KbManifest | null = null
let vectors: Float32Array | null = null
let dimension = 0
let norms: Float32Array | null = null

let localExtractorPromise: Promise<any> | null = null
let localModelName: string | null = null

async function getLocalExtractor(model: string) {
	if (localExtractorPromise && localModelName === model) return localExtractorPromise
	localModelName = model
	localExtractorPromise = import('@xenova/transformers').then(async (m: any) => {
		const pipeline = m?.pipeline
		if (typeof pipeline !== 'function') {
			throw new Error('无法加载 @xenova/transformers 的 pipeline()')
		}
		return await pipeline('feature-extraction', model)
	})
	return localExtractorPromise
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`加载失败：${url} (${res.status})`)
	return (await res.json()) as T
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`加载失败：${url} (${res.status})`)
	return await res.arrayBuffer()
}

function computeNorm(vec: Float32Array) {
	let sum = 0
	for (let i = 0; i < vec.length; i += 1) {
		const v = vec[i] ?? 0
		sum += v * v
	}
	return Math.sqrt(sum)
}

function dot(a: Float32Array, aOffset: number, b: Float32Array) {
	let sum = 0
	for (let i = 0; i < b.length; i += 1) {
		const av = a[aOffset + i] ?? 0
		const bv = b[i] ?? 0
		sum += av * bv
	}
	return sum
}

async function embedQuery(input: string, cfg: KbWorkerSearchMessage['embedding']): Promise<Float32Array> {
	if (cfg.provider === 'local') {
		const extractor = await getLocalExtractor(cfg.model)
		const out = await extractor(input, { pooling: 'mean', normalize: true })
		const emb = out?.data
		if (!emb || !(emb instanceof Float32Array) || emb.length === 0) {
			throw new Error('本地 Embedding 返回为空')
		}
		return emb
	}

	const baseUrl = cfg.baseUrl.replace(/\/$/, '')
	const res = await fetch(`${baseUrl}/embeddings`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${cfg.apiKey}`
		},
		body: JSON.stringify({
			model: cfg.model,
			input
		})
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Embedding 请求失败：${res.status} ${text}`)
	}
	const json: any = await res.json()
	const emb: number[] | undefined = json?.data?.[0]?.embedding
	if (!emb || emb.length === 0) throw new Error('Embedding 返回为空')
	return Float32Array.from(emb)
}

function topKSimilar(queryVec: Float32Array, topK: number) {
	if (!manifest || !vectors || !norms) throw new Error('知识库未初始化')
	if (queryVec.length !== dimension) throw new Error('Query embedding 维度不匹配')

	const qNorm = computeNorm(queryVec)
	const results: Array<{ i: number; score: number }> = []

	for (let i = 0; i < manifest.chunks.length; i += 1) {
		const offset = i * dimension
		const denom = qNorm * (norms[i] ?? 0)
		if (!denom) continue
		const score = dot(vectors, offset, queryVec) / denom
		results.push({ i, score })
	}

	results.sort((a, b) => b.score - a.score)
	return results.slice(0, topK).map(({ i, score }) => ({
		score,
		chunk: manifest!.chunks[i]
	}))
}

self.onmessage = async (ev: MessageEvent<KbWorkerIncomingMessage>) => {
	try {
		const msg = ev.data
		if (msg.type === 'init') {
			manifest = await fetchJson<KbManifest>(msg.manifestUrl)
			dimension = manifest.embedding.dimension
			const buf = await fetchArrayBuffer(msg.vectorsUrl)
			vectors = new Float32Array(buf)

			const expected = manifest.chunks.length * dimension
			if (vectors.length !== expected) {
				throw new Error(`vectors.bin 长度不匹配：expected=${expected}, actual=${vectors.length}`)
			}

			norms = new Float32Array(manifest.chunks.length)
			for (let i = 0; i < manifest.chunks.length; i += 1) {
				const offset = i * dimension
				norms[i] = computeNorm(vectors.subarray(offset, offset + dimension))
			}

			self.postMessage({ type: 'inited', chunkCount: manifest.chunks.length, dimension })
			return
		}

		if (msg.type === 'search') {
			const q = msg.query.trim()
			if (!q) {
				self.postMessage({ type: 'searchResult', matches: [] })
				return
			}

			const qVec = await embedQuery(q, msg.embedding)
			const matches = topKSimilar(qVec, msg.topK)
			self.postMessage({ type: 'searchResult', matches })
			return
		}
	} catch (err: any) {
		self.postMessage({
			type: 'error',
			message: err?.message ?? String(err)
		})
	}
}

export type KbManifest = {
	version: 1
	createdAt: string
	embedding: {
		provider: 'openai-compatible' | 'local'
		model: string
		dimension: number
	}
	chunks: Array<{
		id: string
		sourcePath: string
		index: number
		text: string
	}>
}

export type KbWorkerInitMessage = {
	type: 'init'
	manifestUrl: string
	vectorsUrl: string
}

export type KbWorkerSearchMessage = {
	type: 'search'
	query: string
	topK: number
	embedding:
		| {
			provider: 'openai-compatible'
			baseUrl: string
			apiKey: string
			model: string
		}
		| {
			provider: 'local'
			model: string
		}
}

export type KbWorkerIncomingMessage = KbWorkerInitMessage | KbWorkerSearchMessage

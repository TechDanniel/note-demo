export type KbManifest = {
	version: 1
	createdAt: string
	embedding: {
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
		{
			apiKey: string
			model: string
		}
}

export type KbWorkerIncomingMessage = KbWorkerInitMessage | KbWorkerSearchMessage

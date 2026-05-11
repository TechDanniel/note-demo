export type Match = {
	score: number
	chunk: { id: string; sourcePath: string; index: number; text: string }
}

export type WorkerMsg =
	| { type: 'inited'; chunkCount: number; dimension: number }
	| { type: 'searchResult'; matches: Match[] }
	| { type: 'error'; message: string }

export type Match = {
	score: number
	chunk: { id: string; sourcePath: string; index: number; text: string }
}

export type WorkerMsg =
	| { type: 'inited'; chunkCount: number; dimension: number }
	| { type: 'searchResult'; matches: Match[] }
	| { type: 'error'; message: string }

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatThread = {
	id: string
	createdAt: number
	updatedAt: number
	title?: string
}

export type ChatMessageStatus = 'streaming' | 'done' | 'error'

export type ChatMessage = {
	id: string
	threadId: string
	role: ChatRole
	content: string
	createdAt: number
	updatedAt: number
	status?: ChatMessageStatus
}

export type UiChatMessage = ChatMessage & {
  renderedHtml?: string
}

export type AskOptions ={
  assistantMessageId: string | null
  assistantIdx: number
  assistantRaw: string 
}
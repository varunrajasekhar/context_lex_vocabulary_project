export type Level = 'A1' | 'A2' | 'B1'
export type Status = 'known' | 'needs_practice' | null

export interface Word {
  id: string
  headword: string
  level: Level
  part_of_speech: string
  definition: string
  example: string
  synonyms: string[]
}

export interface LearningWord extends Word { status: Status }
export interface Today {
  date: string
  level: Level
  goal: number
  studied: number
  completed: boolean
  words: LearningWord[]
}

export interface Preferences {
  level: Level
  daily_goal: 3 | 5 | 10 | 15
  timezone: string
  reminder_enabled: boolean
  reminder_hour: number
  reminder_ack_date: string | null
}

export interface Summary {
  total_unique_words_studied: number
  total_card_reviews: number
  days_completed: number
  streak: number
}

export interface HistoryItem {
  word: Word
  status: Exclude<Status, null>
  date: string
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/v1' + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
  } catch {
    throw new Error('Cannot reach the API. Start FastAPI and MongoDB, then retry.')
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Request failed (' + response.status + ')')
  }
  return response.json() as Promise<T>
}

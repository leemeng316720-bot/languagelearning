import type { Engine, LangCode } from './tts'

export interface Entry {
  id: string
  text: string
  lang: LangCode
  createdAt: number
}

export interface Settings {
  engine: Engine // 朗读引擎
  voiceGender: 'f' | 'm' // 在线音色性别
  rate: number // 语速 0.5 - 1.5
  repeat: number // 每条重复次数 1-3
  loop: boolean // 全部连播时是否循环
  voiceMap: Partial<Record<LangCode, string>> // 每种语言选择的系统 voiceURI，'auto' 或缺省为自动
}

const ENTRIES_KEY = 'moerduo.entries.v1'
const SETTINGS_KEY = 'moerduo.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  engine: 'auto',
  voiceGender: 'f',
  rate: 0.9,
  repeat: 1,
  loop: false,
  voiceMap: {},
}

export function loadEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY)
    return raw ? (JSON.parse(raw) as Entry[]) : []
  } catch {
    return []
  }
}

export function saveEntries(entries: Entry[]) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries))
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

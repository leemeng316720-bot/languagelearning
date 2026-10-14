import type { Engine, LangCode } from './tts'

export interface Entry {
  id: string
  text: string
  lang: LangCode
  createdAt: number
  starred?: boolean // 收藏标记
}

export interface Settings {
  engine: Engine // 朗读引擎
  voiceGender: 'f' | 'm' // 在线音色性别
  rate: number // 语速 0.5 - 1.5
  repeat: number // 每条重复次数 1-3
  loop: boolean // 全部连播时是否循环
  gap: number // 连播时条目之间的停顿秒数 0 - 2
  loopOne: boolean // 跟读模式：点读单条时循环朗读直到手动停止
  wakeLock: boolean // 连播时保持屏幕常亮，防止息屏中断
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
  gap: 0.6,
  loopOne: false,
  wakeLock: true,
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

// ---------- 连播断点 ----------

export interface ResumePoint {
  entryId: string
  savedAt: number
}

const RESUME_KEY = 'moerduo.resume.v1'

export function loadResume(): ResumePoint | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY)
    return raw ? (JSON.parse(raw) as ResumePoint) : null
  } catch {
    return null
  }
}

export function saveResume(p: ResumePoint) {
  localStorage.setItem(RESUME_KEY, JSON.stringify(p))
}

export function clearResume() {
  localStorage.removeItem(RESUME_KEY)
}

// ---------- 备份导出 / 导入 ----------

export interface Backup {
  app: 'moerduo'
  version: 1
  exportedAt: string
  entries: Entry[]
  settings: Settings
}

export function buildBackup(entries: Entry[], settings: Settings): string {
  const payload: Backup = {
    app: 'moerduo',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    settings,
  }
  return JSON.stringify(payload, null, 2)
}

const VALID_LANGS: LangCode[] = ['ko', 'en', 'ja', 'zh']

function sanitizeEntry(raw: unknown, i: number): Entry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  if (typeof e.text !== 'string' || !e.text.trim()) return null
  return {
    id: typeof e.id === 'string' && e.id ? e.id : `${newId()}-${i}`,
    text: e.text,
    lang: VALID_LANGS.includes(e.lang as LangCode) ? (e.lang as LangCode) : 'en',
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now() + i,
    starred: e.starred === true,
  }
}

/**
 * 解析备份文件内容。支持两种格式：
 * 1. buildBackup 生成的完整备份（含设置）
 * 2. 纯条目数组（旧版/手工编辑）
 * 解析失败返回 null
 */
export function parseBackup(raw: string): { entries: Entry[]; settings?: Settings } | null {
  try {
    const data = JSON.parse(raw) as unknown
    if (Array.isArray(data)) {
      const entries = data.map(sanitizeEntry).filter((e): e is Entry => e !== null)
      return entries.length > 0 ? { entries } : null
    }
    if (typeof data === 'object' && data !== null) {
      const obj = data as Partial<Backup>
      if (!Array.isArray(obj.entries)) return null
      const entries = obj.entries.map(sanitizeEntry).filter((e): e is Entry => e !== null)
      if (entries.length === 0) return null
      const settings =
        typeof obj.settings === 'object' && obj.settings !== null
          ? { ...DEFAULT_SETTINGS, ...obj.settings }
          : undefined
      return { entries, settings }
    }
    return null
  } catch {
    return null
  }
}

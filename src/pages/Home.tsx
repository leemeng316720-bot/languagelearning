import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Volume2,
  Square,
  Play,
  Plus,
  Trash2,
  Settings2,
  Search,
  Copy,
  Check,
  Eraser,
  Star,
  Pencil,
  Download,
  Upload,
  RotateCcw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { LANGS, detectLang, langInfo, speakSmart, sleep, stopSpeaking } from '@/lib/tts'
import type { Engine, LangCode } from '@/lib/tts'
import { audioCacheCount, clearAudioCache } from '@/lib/onlineTts'
import { edgeTtsUsable } from '@/lib/edgeTts'
import {
  loadEntries,
  loadSettings,
  saveEntries,
  saveSettings,
  newId,
  buildBackup,
  parseBackup,
  loadResume,
  saveResume,
  clearResume,
} from '@/lib/store'
import type { Entry, ResumePoint, Settings } from '@/lib/store'
import { useVoices } from '@/hooks/useVoices'

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (same(d, today)) return '今天'
  if (same(d, yesterday)) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function timeLabel(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>(() => loadEntries())
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [playMode, setPlayMode] = useState<'single' | 'all' | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [clipCount, setClipCount] = useState(0)
  const [starOnly, setStarOnly] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const [resume, setResume] = useState<ResumePoint | null>(() => loadResume())
  const fileRef = useRef<HTMLInputElement>(null)
  const voices = useVoices()
  // UA 不变，只检测一次：当前浏览器能否用 Edge 神经语音
  const edgeUsable = useMemo(() => edgeTtsUsable(), [])

  /** 连播心跳：每开始一条刷新，用于检测息屏后 JS 被系统挂起 */
  const heartbeatRef = useRef(0)
  /** 屏幕常亮句柄（Wake Lock） */
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)

  // 打开设置时刷新语音缓存计数
  useEffect(() => {
    if (sheetOpen) void audioCacheCount().then(setClipCount)
  }, [sheetOpen])

  const sessionRef = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => saveEntries(entries), [entries])
  useEffect(() => saveSettings(settings), [settings])

  // 导入结果提示 3 秒后自动消失
  useEffect(() => {
    if (!importMsg) return
    const t = setTimeout(() => setImportMsg(''), 3000)
    return () => clearTimeout(t)
  }, [importMsg])

  // 页面卸载时停止朗读
  useEffect(() => () => stopSpeaking(), [])

  /** 显示顺序：新的在前；支持收藏筛选 + 搜索过滤 */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(
      (e) =>
        (!starOnly || e.starred) &&
        (!q || e.text.toLowerCase().includes(q)),
    )
  }, [entries, query, starOnly])

  const starredCount = useMemo(() => entries.filter((e) => e.starred).length, [entries])

  /** 按日期分组（保持显示顺序） */
  const groups = useMemo(() => {
    const out: { label: string; items: Entry[] }[] = []
    for (const e of visible) {
      const label = dayLabel(e.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(e)
      else out.push({ label, items: [e] })
    }
    return out
  }, [visible])

  const todayCount = useMemo(
    () => entries.filter((e) => dayLabel(e.createdAt) === '今天').length,
    [entries],
  )

  /** 更新连播断点（state + localStorage 双写，页面被回收后也能找回） */
  const setResumePoint = useCallback((p: ResumePoint | null) => {
    setResume(p)
    if (p) saveResume(p)
    else clearResume()
  }, [])

  /** 连播时请求屏幕常亮（不支持/被拒绝时静默忽略） */
  const acquireWakeLock = useCallback(async () => {
    if (!settingsRef.current.wakeLock) return
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: string) => Promise<{ release: () => Promise<void> }> }
      }
      if (!nav.wakeLock || wakeLockRef.current) return
      wakeLockRef.current = await nav.wakeLock.request('screen')
    } catch {
      /* ignore */
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => undefined)
    wakeLockRef.current = null
  }, [])

  /** 锁屏/通知栏媒体卡片显示当前条目 */
  const setMediaMeta = useCallback((e: Entry) => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: e.text.length > 40 ? `${e.text.slice(0, 40)}…` : e.text,
        artist: '磨耳朵',
        album: langInfo(e.lang).name,
      })
    } catch {
      /* ignore */
    }
  }, [])

  const stopPlayback = useCallback(() => {
    sessionRef.current++
    stopSpeaking()
    setPlayingId(null)
    setPlayMode(null)
    setResumePoint(null) // 用户主动停止，没有断点
    releaseWakeLock()
  }, [setResumePoint, releaseWakeLock])

  const speakEntry = useCallback(async (entry: Entry, session: number) => {
    const s = settingsRef.current
    for (let r = 0; r < s.repeat; r++) {
      if (sessionRef.current !== session) return false
      await speakSmart(entry.text, {
        lang: entry.lang,
        rate: s.rate,
        engine: s.engine,
        voiceURI: s.voiceMap[entry.lang],
        gender: s.voiceGender,
      })
      if (sessionRef.current !== session) return false
      if (r < s.repeat - 1) await sleep(350)
    }
    return true
  }, [])

  /** 朗读单条；跟读模式下循环朗读直到手动停止 */
  const playOne = useCallback(
    async (entry: Entry) => {
      if (playingId === entry.id) {
        stopPlayback()
        return
      }
      const session = ++sessionRef.current
      stopSpeaking()
      setPlayMode('single')
      setPlayingId(entry.id)
      setMediaMeta(entry)
      for (;;) {
        const ok = await speakEntry(entry, session)
        if (!ok || sessionRef.current !== session) return
        if (!settingsRef.current.loopOne) break
        await sleep(500)
        if (sessionRef.current !== session) return
      }
      if (sessionRef.current === session) {
        setPlayingId(null)
        setPlayMode(null)
      }
    },
    [playingId, speakEntry, stopPlayback, setMediaMeta],
  )

  /** 全部连播；传 startId 则从该条开始（断点续播） */
  const playAll = useCallback(
    async (startId?: string) => {
      if (playMode === 'all' && !startId) {
        stopPlayback()
        return
      }
      if (visible.length === 0) return
      const startIdx = startId
        ? Math.max(0, visible.findIndex((e) => e.id === startId))
        : 0
      const session = ++sessionRef.current
      stopSpeaking()
      setPlayMode('all')
      void acquireWakeLock()
      heartbeatRef.current = Date.now()
      let firstRound = true
      do {
        const items = firstRound ? visible.slice(startIdx) : visible
        firstRound = false
        for (const e of items) {
          if (sessionRef.current !== session) return
          heartbeatRef.current = Date.now()
          setResumePoint({ entryId: e.id, savedAt: Date.now() })
          setMediaMeta(e)
          setPlayingId(e.id)
          itemRefs.current.get(e.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          const ok = await speakEntry(e, session)
          if (!ok || sessionRef.current !== session) return
          await sleep(Math.max(0, settingsRef.current.gap) * 1000)
        }
      } while (settingsRef.current.loop && sessionRef.current === session)
      if (sessionRef.current === session) {
        setPlayingId(null)
        setPlayMode(null)
        setResumePoint(null) // 完整播完，没有断点
        releaseWakeLock()
      }
    },
    [playMode, visible, speakEntry, stopPlayback, acquireWakeLock, releaseWakeLock, setResumePoint, setMediaMeta],
  )

  // 息屏/切后台后回到页面：重新申请常亮；若播放链已被系统挂死则复位，露出断点续播条
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (playMode !== 'all') return
      wakeLockRef.current = null // 息屏时系统已自动释放，清掉句柄重新申请
      void acquireWakeLock()
      if (Date.now() - heartbeatRef.current > 90_000) {
        sessionRef.current++
        stopSpeaking()
        setPlayingId(null)
        setPlayMode(null)
        releaseWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [playMode, acquireWakeLock, releaseWakeLock])

  // 锁屏/通知栏媒体控制：暂停、上一条、下一条、继续
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const skip = (dir: 1 | -1) => {
      if (!playingId) return
      const i = visible.findIndex((e) => e.id === playingId)
      const target = visible[i + dir]
      if (!target) return
      if (playMode === 'all') void playAll(target.id)
      else void playOne(target)
    }
    try {
      ms.setActionHandler('pause', stopPlayback)
      ms.setActionHandler('stop', stopPlayback)
      ms.setActionHandler('play', () => {
        const r = loadResume()
        if (r) void playAll(r.entryId)
      })
      ms.setActionHandler('previoustrack', () => skip(-1))
      ms.setActionHandler('nexttrack', () => skip(1))
    } catch {
      /* ignore */
    }
  }, [visible, playingId, playMode, playAll, playOne, stopPlayback])

  const addEntries = useCallback(() => {
    const lines = input
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    const now = Date.now()
    const fresh: Entry[] = lines.map((text, i) => ({
      id: `${newId()}-${i}`,
      text,
      lang: detectLang(text),
      createdAt: now + i,
    }))
    setEntries((prev) => [...fresh.reverse(), ...prev])
    setInput('')
  }, [input])

  const removeEntry = useCallback(
    (id: string) => {
      if (playingId === id) stopPlayback()
      setEntries((prev) => prev.filter((e) => e.id !== id))
    },
    [playingId, stopPlayback],
  )

  /** 点国旗标签循环切换语言（应对纯汉字日语词等识别不准的情况） */
  const cycleLang = useCallback((entry: Entry) => {
    const order: LangCode[] = ['ko', 'en', 'ja', 'zh']
    const next = order[(order.indexOf(entry.lang) + 1) % order.length]
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, lang: next } : e)))
  }, [])

  /** 收藏 / 取消收藏 */
  const toggleStar = useCallback((entry: Entry) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, starred: !e.starred } : e)),
    )
  }, [])

  /** 进入编辑：正在朗读该条时先停下 */
  const startEdit = useCallback(
    (entry: Entry) => {
      if (playingId === entry.id) stopPlayback()
      setEditingId(entry.id)
      setEditText(entry.text)
    },
    [playingId, stopPlayback],
  )

  /** 保存编辑：文本变化后重新识别语言 */
  const saveEdit = useCallback(() => {
    const text = editText.trim()
    const id = editingId
    setEditingId(null)
    if (!id || !text) return
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id && e.text !== text ? { ...e, text, lang: detectLang(text) } : e,
      ),
    )
  }, [editText, editingId])

  /** 导出备份（条目 + 设置）为 JSON 文件 */
  const exportBackup = useCallback(() => {
    const blob = new Blob([buildBackup(entries, settings)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    a.href = url
    a.download = `磨耳朵备份-${stamp}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [entries, settings])

  /** 导入备份：覆盖当前条目（和备份里的设置） */
  const importBackup = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        const parsed = parseBackup(String(reader.result ?? ''))
        if (!parsed) {
          setImportMsg('文件格式不对，导入失败')
          return
        }
        stopPlayback()
        setEntries(parsed.entries)
        if (parsed.settings) setSettings(parsed.settings)
        setEditingId(null)
        setImportMsg(`已导入 ${parsed.entries.length} 条（覆盖了原列表）`)
      }
      reader.onerror = () => setImportMsg('文件读取失败')
      reader.readAsText(file)
    },
    [stopPlayback],
  )

  const clearAll = useCallback(() => {
    stopPlayback()
    setEntries([])
  }, [stopPlayback])

  const copyAll = useCallback(async () => {
    const text = entries
      .slice()
      .reverse()
      .map((e) => e.text)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }, [entries])

  const playingIndex = playingId ? visible.findIndex((e) => e.id === playingId) : -1
  const resumeEntry = resume ? entries.find((e) => e.id === resume.entryId) : undefined

  return (
    <div className="min-h-screen bg-[#FAF6EF] text-stone-800">
      <div className="mx-auto max-w-md px-4 pb-32">
        {/* 头部 */}
        <header className="flex items-center justify-between pt-6 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">磨耳朵</h1>
            <p className="text-xs text-stone-500 mt-0.5">
              共 {entries.length} 条 · 今天新增 {todayCount} 条
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full bg-white"
              onClick={() => setSheetOpen(true)}
              aria-label="设置"
            >
              <Settings2 className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              className="rounded-full bg-[#E85D3D] hover:bg-[#d14e31] text-white shadow-md disabled:opacity-40"
              onClick={() => void playAll()}
              disabled={visible.length === 0}
              aria-label={playMode === 'all' ? '停止连播' : '全部连播'}
            >
              {playMode === 'all' ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
            </Button>
          </div>
        </header>

        {/* 输入区 */}
        <div className="rounded-2xl bg-white p-3 shadow-sm border border-stone-200/60">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'粘贴或输入要记的内容，每行一条\n例如：\n사과 · 苹果\nおはよう · 早上好'}
            rows={3}
            className="w-full resize-none rounded-xl bg-stone-50 p-3 text-[15px] leading-relaxed outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-[#E85D3D]/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addEntries()
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-stone-400">
              每行一条，自动识别语言，混排只读外文部分
            </span>
            <Button
              size="sm"
              className="rounded-full bg-stone-800 hover:bg-stone-700 text-white px-4"
              onClick={addEntries}
              disabled={!input.trim()}
            >
              <Plus className="h-4 w-4 mr-1" />
              加入
            </Button>
          </div>
        </div>

        {/* 搜索 + 收藏筛选 */}
        {(entries.length > 5 || starredCount > 0) && (
          <div className="mt-3 flex items-center gap-2">
            {entries.length > 5 && (
              <div className="flex flex-1 items-center gap-2 rounded-full bg-white border border-stone-200/60 px-3 py-2">
                <Search className="h-4 w-4 text-stone-400 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400"
                />
              </div>
            )}
            {starredCount > 0 && (
              <button
                onClick={() => setStarOnly((v) => !v)}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 text-xs transition-colors ${
                  starOnly
                    ? 'border-amber-300 bg-amber-100 text-amber-700'
                    : 'border-stone-200/60 bg-white text-stone-500 hover:bg-stone-50'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${starOnly ? 'fill-current' : ''}`} />
                收藏 {starredCount}
              </button>
            )}
          </div>
        )}

        {/* 列表 */}
        {visible.length === 0 ? (
          <div className="mt-16 text-center text-stone-400">
            <Volume2 className="mx-auto h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm leading-relaxed">
              {entries.length === 0
                ? '还没有内容\n把今天学的单词或句子粘贴上来吧'
                : '没有匹配的内容'}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <section key={g.label}>
                <h2 className="mb-2 px-1 text-xs font-semibold text-stone-400 tracking-wide">
                  {g.label}
                </h2>
                <div className="space-y-2">
                  {g.items.map((entry) => {
                    const isPlaying = playingId === entry.id
                    const lang = langInfo(entry.lang)
                    const sizeClass =
                      entry.text.length <= 10
                        ? 'text-xl font-semibold'
                        : entry.text.length <= 30
                          ? 'text-lg font-medium'
                          : 'text-[15px]'
                    return (
                      <div
                        key={entry.id}
                        ref={(el) => {
                          if (el) itemRefs.current.set(entry.id, el)
                          else itemRefs.current.delete(entry.id)
                        }}
                        className={`flex items-center gap-3 rounded-2xl border bg-white p-3 transition-all ${
                          isPlaying
                            ? 'border-[#E85D3D] shadow-md shadow-orange-100'
                            : 'border-stone-200/60 shadow-sm'
                        }`}
                      >
                        <button
                          onClick={() => playOne(entry)}
                          aria-label="朗读"
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                            isPlaying
                              ? 'bg-[#E85D3D] text-white'
                              : 'bg-orange-50 text-[#E85D3D] hover:bg-orange-100'
                          }`}
                        >
                          {isPlaying ? (
                            <Square className="h-4 w-4 fill-current" />
                          ) : (
                            <Volume2 className="h-5 w-5" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          {editingId === entry.id ? (
                            <div>
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={2}
                                autoFocus
                                className="w-full resize-none rounded-lg bg-stone-50 p-2 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-[#E85D3D]/30"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit()
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                              />
                              <div className="mt-1.5 flex justify-end gap-2">
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="rounded-full px-3 py-1 text-xs text-stone-500 hover:bg-stone-100"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={saveEdit}
                                  disabled={!editText.trim()}
                                  className="rounded-full bg-stone-800 px-3 py-1 text-xs text-white disabled:opacity-40"
                                >
                                  保存
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className="cursor-pointer"
                              onClick={() => playOne(entry)}
                            >
                              <p className={`break-words leading-snug ${sizeClass}`}>
                                {entry.text}
                              </p>
                              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-400">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    cycleLang(entry)
                                  }}
                                  className="rounded-full bg-stone-100 px-1.5 py-0.5 hover:bg-stone-200 active:bg-stone-300 transition-colors"
                                  title="识别不准？点按切换语言"
                                >
                                  {lang.flag} {lang.name}
                                </button>
                                <span>· {timeLabel(entry.createdAt)}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleStar(entry)
                                  }}
                                  aria-label={entry.starred ? '取消收藏' : '收藏'}
                                  className={`rounded-full p-1 transition-colors ${
                                    entry.starred
                                      ? 'text-amber-500'
                                      : 'text-stone-300 hover:text-amber-400'
                                  }`}
                                >
                                  <Star
                                    className={`h-3.5 w-3.5 ${entry.starred ? 'fill-current' : ''}`}
                                  />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    startEdit(entry)
                                  }}
                                  aria-label="编辑"
                                  className="rounded-full p-1 text-stone-300 hover:text-stone-500 transition-colors"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => removeEntry(entry.id)}
                          aria-label="删除"
                          className="shrink-0 rounded-full p-2 text-stone-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 断点续播条：连播被息屏打断、或页面被系统回收后回来时显示 */}
      {resume && playMode === null && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <RotateCcw className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {resumeEntry ? resumeEntry.text : '该条已删除，将从头播放'}
              </p>
              <p className="text-[11px] text-stone-400">连播中断 · 从断点继续</p>
            </div>
            <Button
              size="sm"
              className="rounded-full bg-[#E85D3D] hover:bg-[#d14e31] text-white"
              onClick={() => void playAll(resume.entryId)}
            >
              <Play className="h-3.5 w-3.5 fill-current mr-1" />
              继续
            </Button>
            <button
              aria-label="忽略断点"
              className="shrink-0 rounded-full p-1.5 text-stone-300 hover:text-stone-500 transition-colors"
              onClick={() => setResumePoint(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 连播底部状态栏 */}
      {playMode === 'all' && playingId && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E85D3D] text-white animate-pulse">
              <Volume2 className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {visible[playingIndex]?.text}
              </p>
              <p className="text-[11px] text-stone-400">
                连播中 · 第 {playingIndex + 1} / {visible.length} 条
                {settings.loop ? ' · 循环' : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={stopPlayback}
            >
              <Square className="h-3 w-3 fill-current mr-1" />
              停止
            </Button>
          </div>
        </div>
      )}

      {/* 设置抽屉 */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>设置</SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-4">
            {/* 朗读引擎 */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">朗读引擎</label>
                <Select
                  value={settings.engine}
                  onValueChange={(v) => setSettings((s) => ({ ...s, engine: v as Engine }))}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动</SelectItem>
                    <SelectItem value="online">在线优先</SelectItem>
                    <SelectItem value="system">系统语音</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-1 text-[11px] text-stone-400 leading-relaxed">
                在线引擎整句自然发音，不依赖手机语音包，需要联网；
                读过的内容会缓存到本机，之后离线也能播。「自动」= 有系统语音用系统，没有就用在线。
              </p>
              <p
                className={`mt-1.5 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed ${
                  edgeUsable
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-amber-50 text-amber-600'
                }`}
              >
                {edgeUsable
                  ? '✓ 当前是 Edge 浏览器：在线发音使用微软神经语音，音质最佳，免费直连'
                  : '当前浏览器将用百度发音。用手机 Edge 浏览器（免费）打开本页，可解锁微软神经语音，音质更好'}
              </p>
            </div>

            {/* 在线音色 */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">在线音色</label>
              <Select
                value={settings.voiceGender}
                onValueChange={(v) => setSettings((s) => ({ ...s, voiceGender: v as 'f' | 'm' }))}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="f">女声</SelectItem>
                  <SelectItem value="m">男声</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 语速 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">语速</label>
                <span className="text-sm text-stone-500">{settings.rate.toFixed(2)}x</span>
              </div>
              <Slider
                value={[settings.rate]}
                min={0.5}
                max={1.5}
                step={0.05}
                onValueChange={([v]) => setSettings((s) => ({ ...s, rate: v }))}
              />
              <div className="mt-1 flex justify-between text-[11px] text-stone-400">
                <span>慢 · 跟读</span>
                <span>快 · 磨耳朵</span>
              </div>
            </div>

            {/* 重复次数 */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">每条朗读</label>
              <Select
                value={String(settings.repeat)}
                onValueChange={(v) => setSettings((s) => ({ ...s, repeat: Number(v) }))}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 遍</SelectItem>
                  <SelectItem value="2">2 遍</SelectItem>
                  <SelectItem value="3">3 遍</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 循环 */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">连播循环</label>
                <p className="text-[11px] text-stone-400">播完一遍后从头再来</p>
              </div>
              <Switch
                checked={settings.loop}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, loop: v }))}
              />
            </div>

            {/* 连播间隔 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">连播间隔</label>
                <span className="text-sm text-stone-500">{settings.gap.toFixed(1)} 秒</span>
              </div>
              <Slider
                value={[settings.gap]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={([v]) => setSettings((s) => ({ ...s, gap: v }))}
              />
              <div className="mt-1 flex justify-between text-[11px] text-stone-400">
                <span>紧凑</span>
                <span>留白 · 跟读回味</span>
              </div>
            </div>

            {/* 单条复读 */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">跟读模式</label>
                <p className="text-[11px] text-stone-400">
                  点读单条时循环朗读，再点一次停止
                </p>
              </div>
              <Switch
                checked={settings.loopOne}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, loopOne: v }))}
              />
            </div>

            {/* 屏幕常亮 */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">连播时屏幕常亮</label>
                <p className="text-[11px] text-stone-400">
                  防止息屏中断；手动锁屏后回来可从断点继续
                </p>
              </div>
              <Switch
                checked={settings.wakeLock}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, wakeLock: v }))}
              />
            </div>

            {/* 各语言音色 */}
            <div className="space-y-3">
              <label className="text-sm font-medium">系统音色（离线）</label>
              {LANGS.map((l) => {
                const list = voices.filter((v) =>
                  v.lang.toLowerCase().startsWith(l.code),
                )
                return (
                  <div key={l.code} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-stone-600 shrink-0">
                      {l.flag} {l.name}
                      {voices.length > 0 && list.length === 0 && settings.engine !== 'online' && (
                        <span className="block text-[10px] text-amber-500">
                          系统未安装语音，将用在线引擎
                        </span>
                      )}
                    </span>
                    <Select
                      value={settings.voiceMap[l.code] ?? 'auto'}
                      onValueChange={(v) =>
                        setSettings((s) => ({
                          ...s,
                          voiceMap: { ...s.voiceMap, [l.code as LangCode]: v },
                        }))
                      }
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="自动" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动（系统默认）</SelectItem>
                        {list.map((v) => (
                          <SelectItem key={v.voiceURI} value={v.voiceURI}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
              {voices.length === 0 && (
                <p className="text-[11px] text-stone-400">
                  正在加载系统语音…若长时间为空，请直接用「自动」。
                </p>
              )}
            </div>

            {/* 数据 */}
            <div className="space-y-2 border-t border-stone-100 pt-4">
              <label className="text-sm font-medium">数据</label>
              <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                <span className="text-sm text-stone-600">
                  语音缓存 <span className="text-stone-400">（{clipCount} 段）</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-stone-500"
                  disabled={clipCount === 0}
                  onClick={async () => {
                    await clearAudioCache()
                    setClipCount(0)
                  }}
                >
                  清空缓存
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={copyAll}>
                  {copied ? (
                    <Check className="h-4 w-4 mr-1 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  {copied ? '已复制' : '复制全部文本'}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex-1 text-red-500 hover:text-red-600"
                      disabled={entries.length === 0}
                    >
                      <Eraser className="h-4 w-4 mr-1" />
                      清空列表
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>清空全部 {entries.length} 条？</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作不可恢复。建议先「复制全部文本」备份。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={clearAll}
                        className="bg-red-500 hover:bg-red-600"
                      >
                        清空
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={exportBackup}
                  disabled={entries.length === 0}
                >
                  <Download className="h-4 w-4 mr-1" />
                  导出备份
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  导入备份
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importBackup(f)
                    e.target.value = ''
                  }}
                />
              </div>
              {importMsg && (
                <p className="text-[11px] text-stone-500">{importMsg}</p>
              )}
              <p className="text-[11px] text-stone-400">
                数据保存在本机浏览器中，不会上传。备份文件含条目和设置，导入会覆盖当前列表。
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

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
import {
  loadEntries,
  loadSettings,
  saveEntries,
  saveSettings,
  newId,
} from '@/lib/store'
import type { Entry, Settings } from '@/lib/store'
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
  const voices = useVoices()

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

  // 页面卸载时停止朗读
  useEffect(() => () => stopSpeaking(), [])

  /** 显示顺序：新的在前；搜索时过滤 */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.text.toLowerCase().includes(q))
  }, [entries, query])

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

  const stopPlayback = useCallback(() => {
    sessionRef.current++
    stopSpeaking()
    setPlayingId(null)
    setPlayMode(null)
  }, [])

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

  /** 朗读单条 */
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
      const ok = await speakEntry(entry, session)
      if (ok && sessionRef.current === session) {
        setPlayingId(null)
        setPlayMode(null)
      }
    },
    [playingId, speakEntry, stopPlayback],
  )

  /** 全部连播 */
  const playAll = useCallback(async () => {
    if (playMode === 'all') {
      stopPlayback()
      return
    }
    if (visible.length === 0) return
    const session = ++sessionRef.current
    stopSpeaking()
    setPlayMode('all')
    do {
      for (const e of visible) {
        if (sessionRef.current !== session) return
        setPlayingId(e.id)
        itemRefs.current.get(e.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const ok = await speakEntry(e, session)
        if (!ok || sessionRef.current !== session) return
        await sleep(600)
      }
    } while (settingsRef.current.loop && sessionRef.current === session)
    if (sessionRef.current === session) {
      setPlayingId(null)
      setPlayMode(null)
    }
  }, [playMode, visible, speakEntry, stopPlayback])

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
              onClick={playAll}
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

        {/* 搜索 */}
        {entries.length > 5 && (
          <div className="mt-3 flex items-center gap-2 rounded-full bg-white border border-stone-200/60 px-3 py-2">
            <Search className="h-4 w-4 text-stone-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400"
            />
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
                        <div
                          className="min-w-0 flex-1 cursor-pointer"
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
                          </div>
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
                在线引擎（Naver / 百度）整句自然发音，不依赖手机语音包，需要联网；
                读过的内容会缓存到本机，之后离线也能播。「自动」= 有系统语音用系统，没有就用在线。
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
              <p className="text-[11px] text-stone-400">
                数据保存在本机浏览器中，不会上传。
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

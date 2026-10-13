// 磨耳朵 Service Worker：应用外壳离线缓存
// 页面资源（HTML/JS/CSS/图标）第一次加载后全部缓存，
// 之后电脑关机也能打开应用；发音音频由 IndexedDB 缓存另行负责

const CACHE = 'moerduo-shell-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  // 发音接口不经过 SW（音频缓存在 IndexedDB 里）
  if (url.pathname === '/api/tts') return
  if (url.origin !== self.location.origin) return

  // 页面导航：网络优先，失败回退缓存的应用首页
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    )
    return
  }

  // 静态资源：缓存优先，未命中则联网并写入缓存
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
          }
          return res
        }),
    ),
  )
})

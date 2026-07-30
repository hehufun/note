# Project Memory — note (网页记事本 PWA)

## 部署与目标
- 通过 GitHub Pages 托管，自定义域名见 `CNAME`（`note.hehu.fun`，**根域**，非 `/note/` 子路径）。
- 腾讯云 COS 也走根域。两者皆根域 → 笔记 key（`note-hehu-fun-` + hash 路径）完全一致，内容互通。
- **全 hash 路由（统一）**：本地 `file://` 与线上 `http(s)` 都走 `#/foo/bar`，不再区分。原因：hash 是唯一「不发给服务器、可在 file:// 下用」的客户端路由符；真实 pathname 在 file:// 下无法映射、且 GitHub 子路径会重复前缀。
- **真实路径 → hash 统一（双路兜底）**：`/foo/bar` 这类无 `#` 的真实路径，无论走哪条链路最终都统一成 `#/foo/bar`：
  - 冷启动（SW 未装）：GitHub 404 → `404.html` 重定向 `location.replace('/#' + location.pathname + location.search)`。
  - 暖路径（SW 已装 / COS 404→index 返回 index.html）：`index.html` 顶部**自举重定向**——若 `location.pathname` 为非根真实路径（`/`/`/index.html`/`/404.html` 除外且当前无 hash），则 `location.replace('/#' + pathname)` 并跳过初始化。`index.html` 不自举则 SW 返回 index.html 时读到空 hash 会落到根笔记。
- 笔记内容存 `localStorage`，key 前缀 `note-hehu-fun-` + 解码后 hash 路径。

## 图标约定（来自 appstore-images.zip）
- 根目录只放三档图标即可满足 PWA + Apple：
  - `icon.svg`（any，可缩放，主图标）、`icon-192.png`、`icon-512.png`（manifest 引用）
  - `apple-touch-icon.png`（iOS 用，180px PNG；iOS 不支持 SVG 的 apple-touch-icon）
- 新平台尺寸从 `appstore-images.zip` 对应子目录（android/ios/windows）抽，不要为每个尺寸单独在 manifest 写一大串。

## 语言中立铁律
- 全部界面文字用 emoji，不要出现任何自然语言文字（含中文「本地」等）。
- 状态/提示一律 emoji：💾 saved、✍️ typing、🔄 loading、✅ 复制成功、📄 file 模式 host 占位。
- 用户明确：emoji 是为了语言中立，不要去掉 emoji 换成文字。

## file:// 链接
- 复制出的完整链接统一为 `file://` + pathname + `#` + path → `file:///C:/.../index.html#/foo/bar`，点击可直接导航（file:// 的 origin 是 `file://`，拼出三斜杠）。
- 线上同样结构：`origin + pathname + '#' + path`。

## 同路径多实例同步
- 窗口失焦（`blur`）或隐藏（`visibilitychange:hidden`）→ 立即 `saveNow()` 落盘。
- 获得焦点（`focus`）或可见（`visibilitychange:visible`）→ `load()` 重新载入，保证同路径的多个标签页/窗口内容一致。
- 侧贴并排不会实时同步（仅随焦点切换同步），符合需求；如需实时可加 `storage` 事件监听（未做）。

## 云端同步（Cloud Sync）规划
- 目标：通过状态圆点 ⚫ 点击触发同步面板，输入自定义同步 ID，同一 ID 可跨设备共享笔记内容。
- 后端：Cloudflare Worker + KV，两个端点：
  - `PUT /api/sync/:id` — 接收 gzip 压缩后的 raw bytes，写入 KV。
  - `GET /api/sync/:id` — 从 KV 读取 raw bytes 返回。
- 前端压缩：浏览器原生 `CompressionStream('gzip')` / `DecompressionStream('gzip')`，零外部依赖。
- 无加密、无鉴权——ID 即钥匙，用户自行选择复杂度防碰撞。
- CF 免费额度：100K 请求/天、1GB KV 存储，个人笔记绰绰有余。
- 同步 ID 存 `localStorage` key `note-hehu-fun-cloud-sync-id`，下次点击自动回填。
- **当前状态：前端 UI 已实现，Worker 代码和 API 调用待部署后对接。**

# 云端同步部署指南（Cloudflare Worker + KV）

## 架构全景

```
┌─────────────────────────────────────────────────────────┐
│ 前端（index.html）                                       │
│                                                         │
│  🕐 17:43   ⬆️   🟢   ⬇️   [work]                       │
│               │    │    │     └─ sync ID (16 字符)        │
│               │    │    └─────── 下载                    │
│               │    └──────────── 点击 → 输入 ID            │
│               └───────────────── 上传                     │
│                                                         │
│  gzip(text) → PUT /{sid}?p={path} → Worker → KV         │
│  GET /{sid}?p={path} → ungzip → editor.value             │
│                                                         │
│  key = sid + "::" + path  （:: 分隔，防碰撞）              │
└─────────────────────────────────────────────────────────┘
```

---

## 同步逻辑详解

### KV 键设计

| 要素                   | 限制                    | 说明                                                                                |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| 同步 ID `syncId`       | ≤16 字符                | URL path 传递，`encodeURIComponent` 编码，支持 `/`、中文、emoji 等                    |
| 页面路径 `pagePath`    | ≤16 字符                | query param `?p=` 传递，同样 `encodeURIComponent`，同样支持任意字符                    |
| KV key                 | `{sid} + "::" + {path}` | `"::"` 分隔防止意外碰撞（例 `a/b`+`/c` 与 `a`+`/b/c` 不再冲突）                      |
| API URL 格式            | `PUT/GET /{sid}?p={path}` | 两个参数独立编码，Worker 端各自 `decodeURIComponent` 还原                             |

**按页面独立同步**：

- ID `work` + 页面 `/notes` → URL `/work?p=%2Fnotes` → KV `work::/notes`
- ID `work` + 页面 `/todo` → URL `/work?p=%2Ftodo` → KV `work::/todo`
- ID `home` + 页面 `/notes` → URL `/home?p=%2Fnotes` → KV `home::/notes`
- 上传只传当前页，下载只取当前页，互不干扰

> **与旧设计的区别**：旧方案直接把 `{sid}{path}` 拼接成 `/work/notes`，如果 sid 含 `/` 则边界模糊、可能碰撞。新方案将 sid 放 path、path 放 query，各自独立编码，Worker 以 `::` 分隔存为 KV key，彻底防碰撞。

### 用户交互

```
点击 🟢 绿点           → 进入 ID 输入（原地编辑，回车/失焦保存）
输入后 text 变灰显示   → 风格统一（和时间、网址一样用 var(--muted)）

点击 ⬆️               → 上传：锁定编辑区 + 禁用所有按钮 + 绿点闪灰
                        完成 → 绿点变绿 + 恢复锁定态

点击 ⬇️               → 下载：同上
                        （错误 → 绿点变红 + 恢复锁定态）
```

### 同步期间防护

| 按钮    | 状态                                             |
| ------- | ------------------------------------------------ |
| ⬆️ ⬇️   | `pointer-events: none` + `opacity: 0.3`          |
| 🔓🔒 锁 | 同上，不可点击切换                               |
| 编辑区  | `editor.readOnly = true`（暂锁）                 |
| 完成后  | 恢复原始锁状态（原本锁着就继续锁，原本开着就开） |

### URL 带 ID 分享

复制链接时自动附带 ID：

```
http://note.hehu.fun/#/notes?id=mywork
```

打开该链接时：

1. 路径定位到 `/notes`
2. ID 自动回填 `mywork`
3. 加载本地内容后，**延迟 300ms 自动触发下载同步**
4. 同步期间编辑区自动锁住

---

## 前置条件

- Cloudflare 账号（免费套餐即可）
- 已安装 Node.js + npm
- 已安装 wrangler CLI：`npm install -g wrangler`

---

## 第一步：创建 Worker 项目

```bash
mkdir note-sync-worker
cd note-sync-worker
```

## 第二步：编写 Worker 代码

创建 `src/index.js`：

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const rawSid = url.pathname.slice(1);
    const rawPath = url.searchParams.get("p");

    if (!rawSid || rawPath === null) {
      return new Response("missing syncId or path", { status: 400 });
    }

    // decodeURIComponent 还原编码前的原始 syncId 和 pagePath
    // （二者都可以包含 /、中文、emoji 等任意字符）
    const sid = decodeURIComponent(rawSid);
    const pagePath = decodeURIComponent(rawPath);
    const key = sid + "::" + pagePath; // "::" 防止不同组合算出相同 key

    if (request.method === "PUT") {
      const body = await request.arrayBuffer();
      await env.SYNC.put(key, body);
      return new Response("ok", { status: 200 });
    }

    if (request.method === "GET") {
      const data = await env.SYNC.get(key, "arrayBuffer");
      if (!data) {
        return new Response("not found", { status: 404 });
      }
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    return new Response("method not allowed", { status: 405 });
  },
};
```

## 第三步：创建 wrangler.toml

```toml
name = "note-sync"
main = "src/index.js"
compatibility_date = "2025-07-30"

[[kv_namespaces]]
binding = "SYNC"
id = "{{KV_ID}}"   # 创建 KV 后替换
```

## 第四步：创建 KV 命名空间

```bash
wrangler kv:namespace create SYNC
```

输出类似：

```
🌀 Creating namespace with title "note-sync-SYNC"
✅ Success: Created namespace with ID "abc123def456..."
```

把输出的 ID ��换到 `wrangler.toml` 的 `{{KV_ID}}`。

## 第五步：部署

```bash
wrangler deploy
```

部署成功后终端会输出 Worker 地址，例如：

```
https://note-sync.your-subdomain.workers.dev
```

---

## 第六步：自定义域名（可选）

在 Cloudflare Dashboard → Workers → note-sync → Triggers → Custom Domains，绑定 `sync.hehu.fun`（或想要的子域名）。

---

## 第七步：前端接入

### 7.1 设置 API 地址

打开 `index.html`，找到：

```js
const SYNC_API = ""; // TODO: set after deploying Worker
```

改为：

```js
const SYNC_API = "https://sync.hehu.fun";
```

### 7.2 对接同步函数（如还未替换）

`index.html` 里 `syncUploadAction` 和 `syncDownloadAction` 已替换为真实实现，部署 Worker 后只需改 `SYNC_API` 地址。

如需手动确认，两个函数的核心调用代码如下（方案B：`PUT/GET /{sid}?p={path}`）：

```js
// === 上传 ===
var sid = syncIdInput.value.trim();
var u = SYNC_API
  + "/" + encodeURIComponent(sid)
  + "?p=" + encodeURIComponent(currentPath);
var resp = await fetch(u, { method: "PUT", body: compressed });

// === 下载 ===
var u = SYNC_API
  + "/" + encodeURIComponent(sid)
  + "?p=" + encodeURIComponent(currentPath);
var resp = await fetch(u);
```

---

## 完整项目结构

```
note-sync-worker/
├── src/
│   └── index.js       # Worker 代码（~20 行）
├── wrangler.toml       # 部署配置
└── package.json        # 可选
```

---

## 注意事项

| 项目     | 说明                                                |
| -------- | --------------------------------------------------- |
| 无鉴权   | ID 即密码，自行选择复杂度                           |
| 无加密   | 压缩传输但不加密，适合非敏感笔记                    |
| 免费额度 | 100K 请求/天、1GB KV、1000 写/天                    |
| 压缩比   | 中文文本 gzip 后约 3-5x                             |
| ID 字符  | 支持任意 Unicode（中/日/emoji 等），≤16 字符        |
| 路径字符 | 支持任意 Unicode，≤16 字符                          |
| 兼容性   | `CompressionStream` 需 Chrome 80+，现代浏览器全支持 |

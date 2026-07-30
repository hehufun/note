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
│  gzip(text) → PUT /work%2Fnotes → Worker → KV           │
│  GET /work%2Fnotes → ungzip → editor.value              │
└─────────────────────────────────────────────────────────┘
```

---

## 同步逻辑详解

### KV 键设计

| 要素                   | 限制                    | 说明                                                                        |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------- |
| 页面路径 `currentPath` | ≤16 字符                | 顶部输入栏，HTML `maxlength` + JS `slice(0,16)` 双重兜底                    |
| 同步 ID `syncId`       | ≤16 字符                | 底部 🟢 点击输入，同样双重兜底                                              |
| KV key                 | `{syncId}{currentPath}` | 例 `work/notes`，经 `encodeURIComponent` 最坏 ~96 bytes，远低于 KV 512 上限 |

**按页面独立同步**：

- ID `work` + 页面 `/notes` → KV `work/notes`
- ID `work` + 页面 `/todo` → KV `work/todo`
- ID `home` + 页面 `/notes` → KV `home/notes`
- 上传只传当前页，下载只取当前页，互不干扰

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
    const id = url.pathname.slice(1); // strip leading /

    if (!id) {
      return new Response("missing id", { status: 400 });
    }

    if (request.method === "PUT") {
      const body = await request.arrayBuffer();
      await env.SYNC.put(id, body);
      return new Response("ok", { status: 200 });
    }

    if (request.method === "GET") {
      const data = await env.SYNC.get(id, "arrayBuffer");
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

### 7.2 替换同步函数

找到 `syncUploadAction` 和 `syncDownloadAction` 中的 `setTimeout(..., 600)` 模拟代码，替换为：

```js
// === 上传 ===
async function syncUploadAction() {
  var wasLocked = lockForSync();
  setSyncDot("loading");
  setSyncBusy(true);
  try {
    const text = editor.value;
    const key = encodeURIComponent(syncIdInput.value.trim() + currentPath);
    const encoder = new TextEncoder();
    const stream = new Blob([encoder.encode(text)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const compressed = await new Response(stream).arrayBuffer();
    const resp = await fetch(SYNC_API + "/" + key, {
      method: "PUT",
      body: compressed,
    });
    setSyncDot(resp.ok ? "saved" : "error");
  } catch (e) {
    setSyncDot("error");
  }
  setSyncBusy(false);
  unlockAfterSync(wasLocked);
}

// === 下载 ===
async function syncDownloadAction() {
  var wasLocked = lockForSync();
  setSyncDot("loading");
  setSyncBusy(true);
  try {
    const key = encodeURIComponent(syncIdInput.value.trim() + currentPath);
    const resp = await fetch(SYNC_API + "/" + key);
    if (!resp.ok) {
      setSyncDot("error");
      setSyncBusy(false);
      unlockAfterSync(wasLocked);
      return;
    }
    const compressed = await resp.arrayBuffer();
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(stream).text();
    editor.value = text;
    saveNow();
    setSyncDot("saved");
  } catch (e) {
    setSyncDot("error");
  }
  setSyncBusy(false);
  unlockAfterSync(wasLocked);
}
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

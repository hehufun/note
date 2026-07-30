# note-sync Worker

Cloudflare Worker 为 📝 note PWA 提供云端同步后端。

## API

```
PUT  /{syncId}?p={pagePath}  上传笔记（gzip 压缩）
GET  /{syncId}?p={pagePath}  下载笔记
```

- `syncId` — 同步 ID（任意 Unicode，≥0 字符）
- `pagePath` — 页面路径（任意 Unicode，含 `/`）
- KV key = `{syncId}::{pagePath}` （`::` 分隔防碰撞）

## 部署

```bash
cd worker/
npx wrangler deploy
```

## 配置

`wrangler.toml` 中的 KV namespace ID 在首次部署前需创建：

```bash
npx wrangler kv namespace create SYNC
# 把输出 ID 填入 wrangler.toml
```

## 前端对接

`index.html` 中设置：

```js
const SYNC_API = "https://note-sync.hehufun.workers.dev";
```

上传下载已通过 `CompressionStream('gzip')` 实现，详见 `index.html` 中 `syncUploadAction` / `syncDownloadAction`。

## 安全

- 无鉴权，syncId 即钥匙
- 无加密，gzip 仅压缩
- 请勿使用简单 syncId（避免被碰撞）

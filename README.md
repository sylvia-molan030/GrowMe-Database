# GrowMe-Database

GrowMe 买量素材复盘 BI · 数据看板

## 在线地址

| 平台 | 地址 | 说明 |
|------|------|------|
| **Cloudflare Pages**（推荐） | `https://growme-database.pages.dev` | 连 GitHub 后自动部署，不依赖 GitHub Actions |
| Netlify | `https://growme-database.netlify.app` | 备选 |
| GitHub Pages | https://sylvia-molan030.github.io/GrowMe-Database/ | 备用（Actions 故障时可能卡住） |

首次部署见 **[上线指南.md](./上线指南.md)**。

## 更新数据

```bash
# 账户全量
./scripts/update_account.sh --push ~/Downloads/全数据更新.csv

# 周度上新
./scripts/update_weekly.sh --push ~/Downloads/0713周老素材.csv ~/Downloads/0713周新创意素材.csv
```

## 本地开发

```bash
./start.sh
# http://localhost:8000
```

## 仓库部署配置

- `netlify.toml` — Netlify 发布目录 `docs/`
- `wrangler.toml` — Cloudflare Pages 发布目录 `docs/`

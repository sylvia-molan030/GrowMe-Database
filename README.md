# GrowMe-Database

GrowMe 买量素材复盘 BI · 数据看板

**在线地址：** https://sylvia-molan030.github.io/GrowMe-Database/

## 数据更新流程（GitHub 自动同步）

1. 将新数据放入 `data_inputs/`：
   - `account_all_WW.csv` — 账户全量（账户内成效）
   - `0525week WW.xlsx`、`0601周WW的数据.csv` — 周度上新（上新素材成效 / 核心资产晋级库）

2. 本地构建并推送：

```bash
cd growme
./scripts/deploy.sh
git commit -m "更新 GrowMe 数据"
git push
```

3. 在仓库 **Settings → Pages** 中设置：
   - Source：**Deploy from a branch**
   - Branch：**main** · 文件夹：**/web**
   - 保存后约 1–2 分钟可访问

## 本地开发

```bash
./start.sh
# 打开 http://localhost:8000
```

## 数据分层

| 视图 | 数据文件 |
|------|----------|
| 账户内成效 | `account_all_WW.csv` |
| 上新素材成效 | `*week*` / `*周*` WW 文件 |
| 核心资产晋级库 | 同上（0525 + 0601 周） |

## 设计师分类

gy · wxx · fj · jql · 095KB · pingme · jpl · 其他

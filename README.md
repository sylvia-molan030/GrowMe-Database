# GrowMe-Database

GrowMe 买量素材复盘 BI · 数据看板

**在线地址：** https://sylvia-molan030.github.io/GrowMe-Database/

## 开启 GitHub Pages（只需一次）

1. 打开 https://github.com/sylvia-molan030/GrowMe-Database/settings/pages
2. **Source**：Deploy from a branch
3. **Branch**：`main`
4. **文件夹**：`/docs`（GitHub 只支持 root 或 docs）
5. Save，等 1～2 分钟

## 更新数据

```bash
cd /Users/sylvia/Desktop/sylvia/growme
python3 scripts/build_static.py
git add data_inputs/ docs/data/snapshot.json
git commit -m "更新数据"
git push
```

## 本地开发

```bash
./start.sh
# http://localhost:8000
```

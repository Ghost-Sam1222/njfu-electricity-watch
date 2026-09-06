# 南林电力守夜

南京林业大学一卡通电费余额监控、Bark 预警、静态看板和账单导出脚手架。

## 第一阶段目标

先跑通 GitHub Actions 自动查询和 Bark 预警。看板文件已经在 `docs/`，但私有仓库的 GitHub Pages 可能受账号计划限制，后面第二阶段再接 GitHub Pages 或 Cloudflare。

仓库里需要两个 Secrets：

```text
SYNJONES_AUTH = 一卡通 URL 里的 synjones-auth 令牌，可以带 bearer，也可以只填 token
BARK_URL = 你的 Bark 推送 URL
```

如果 GitHub Actions 访问学校一卡通接口超时，再加一个可从 GitHub 云端访问的代理 Secret：

```text
HTTPS_PROXY = http://用户名:密码@代理域名:端口
```

Node 运行时已经开启系统代理环境变量支持，会自动读取 `HTTPS_PROXY`、`HTTP_PROXY` 和 `NO_PROXY`。

适合这里的代理需要满足两个条件：

- GitHub Actions 能从公网连上它。
- 代理出口能访问 `https://icard.njfu.edu.cn/charge-app/` 和 `/charge/feeitem/getThirdData`。

不适合的情况：只开在你电脑上的本地代理、只允许局域网访问的代理、出口也访问不了学校一卡通的海外代理。

填好代理后，可以手动运行 `Electricity Watch`，把 `diagnose` 输入设成 `true`。它只测试网络，不查询余额、不提交数据。看到 `Open charge API entry: ... payload=yes` 或类似成功结果后，再用默认参数手动运行一次正式查询。

`config/targets.json` 已经按 `10栋717` 配好；除非换宿舍或学校改接口，否则不用碰发现模式。

## 时间和阈值

默认定时是北京时间 `08:05` 和 `22:05`。早上检查昨夜是否安全，晚上检查赶在 `23:45` 充值服务暂停前完成提醒，并给 GitHub Actions 延迟留缓冲。

默认阈值偏保守：

- 空调：`20` 度或 `12` 元以下提醒。按额定输入功率 `999W` 连续运行估算，最坏约 `24` 度/天。
- 照明/插座：`8` 度或 `5` 元以下提醒。先按 `4` 度/天估算，等跑出一周历史后再改成真实日耗的 1.5 到 2 倍。

当前宿舍按 `10栋717` 配置，页面里手动查询时输入的房间码是 `10717`。电价按 `1` 元/度估算。

## 首次配置

我已经按你的宿舍生成了 `config/targets.json`，默认会查询：

- 照明/插座：`https://icard.njfu.edu.cn/charge-app/#/pays?id=489`，楼栋选 `学生公寓10栋`，房间 `10717`
- 空调：`https://icard.njfu.edu.cn/charge-app/#/pays?id=528`，楼栋选 `10栋空调`，房间 `10717`

脚本会自动模拟这个流程：先请求楼栋下拉选项，按文字找到楼栋值，再把房间码带入 `IEC` 查询。你不需要手动知道接口字段名。

如果给别人复用，只改 `config/targets.json` 里的：

```json
{
  "defaults": {
    "roomCode": "10717"
  },
  "targets": [
    { "selectors": ["学生公寓10栋"] },
    { "selectors": ["10栋空调"] }
  ]
}
```

然后在 GitHub 仓库设置 Secrets：

```text
SYNJONES_AUTH = 一卡通 URL 里的 synjones-auth 令牌，可以带 bearer，也可以只填 token
BARK_URL = 你的 Bark 推送 URL
```

第二阶段启用公开看板时，再设置 Variables：

```text
PAGES_BASE_URL = 你的 GitHub Pages 地址，例如 https://<user>.github.io/<repo>
BARK_ICON_URL = 可选；不填时会使用 PAGES_BASE_URL/assets/njfu-power-alert.png
```

如果学校后端以后改了字段，才需要用发现模式排查：

```bash
npm run discover -- 489
npm run discover -- 489 --level 1 --param <字段代码>=<选项值>
npm run discover -- 528
```

每次命令会输出 `fields`、`choices` 和下一步提示。正常情况下，你现在不需要走这一步。

## 异常算法

异常只针对“日耗突增”，低余额仍然由阈值单独判断。

日耗不是实时功率，而是用相邻两次查询的剩余电量下降量估算：余额上涨视为充值或校表，不计入耗电；间隔超过 72 小时的数据不参与判断。

在数据很少时，只使用保守上限：

- 照明/插座：超过 `4 × 1.8 = 7.2` 度/日算异常。
- 空调：超过 `24 × 1.8 = 43.2` 度/日算异常。

当同一项目累计至少 `7` 个有效消耗区间后，再加入历史突增判断：如果当前折算日耗同时高于近期中位数的 `1.7` 倍，并且高于 `中位数 + 3 × 稳健波动值`，就标成异常。这样早期不会因为样本太少乱报，后期会逐渐贴近你们寝室自己的用电习惯。

## 数据存储建议

个人使用阶段，直接用 GitHub 仓库保存 `docs/data/history.json` 最轻便：Actions 查询后提交 JSON，Pages 直接展示，不需要额外服务器。

后期给同学复用时，建议分两档：

- 少量同学、每人自己部署：继续用 GitHub 仓库。每个人只保存自己的 token、房间号和历史数据，隔离简单。
- 多人统一服务：用 Cloudflare Worker + R2。Worker 负责定时查询和鉴权，R2 按用户或房间分文件保存历史数据，GitHub Pages 只做静态前端。R2 更适合长期、多用户、低成本存储，也避免一个仓库不断被 Actions 自动提交刷历史。

## 账单导出

一卡通账单：

```bash
npm run export:bills -- --kind card --from 2026-09-01 --to 2026-09-30
```

电费账单：

```bash
npm run export:bills -- --kind electricity --feeitemid 489 --from 2026-09-01 --to 2026-09-30
```

结果会写入 `exports/bills/*.json` 和 `exports/bills/*.csv`。

## 接口依据

从当前一卡通前端公开脚本还原出的关键入口：

- 本部其他公寓空调：`feeitemid=528`
- 本部研究生楼及 9-13 幢照明：`feeitemid=489`
- 微信端页面：`/charge-app/#/pays?id=528` 和 `/charge-app/#/pays?id=489`
- 电费查询：`POST /charge/feeitem/getThirdData`
- 电费账单：`GET /charge/turnover/app_account`
- 一卡通流水：`GET /berserker-search/search/personal/turnover`

不要把 `SYNJONES_AUTH` 或 Bark token 写进仓库文件。

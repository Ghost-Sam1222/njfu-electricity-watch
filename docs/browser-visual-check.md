# Browser visual verification — 2026-10-29

Verified application revision: `1a31b09`. No application code or layout changes were needed.

The existing in-app browser rendered an isolated copy of `index.html`, CSS, JavaScript modules and the icon, served only on a dynamically assigned loopback port. Data responses were entirely synthetic; no existing `docs/data` files were copied or read. Each page rendered in a same-origin iframe with an actual CSS viewport width of 390px or 1440px. This checks the real browser renderer and responsive CSS; it is not physical iPhone testing.

## Observations

All 24 combinations completed: 12 scenarios at each width. Browser DOM observations confirmed that page width equaled content scroll width at both sizes. Actual screenshots were reviewed for text readability, clipping and status colors.

| Synthetic scenario | Browser result at both widths |
| --- | --- |
| First collection fails, no prior balance | “采集失败”; gray cards; `--`, “尚未查询”, “暂无数据” |
| Failed collection retaining 70 / 40 / 20 | “采集失败”; gray cards; retained balance; “非实时” and “上次成功数据” |
| Successful snapshot older than 18 hours, retaining 70 / 40 / 20 | “数据过期”; gray cards; retained balance; “非实时” and “上次成功数据” |
| No reading | “无数据”; gray cards; `--` instead of zero |
| Recent successful balance 80 | “正常”; normal green/blue balance cards |
| Recent successful balance 70 / 40 | “预警”; yellow warning cards |
| Recent successful balance 20 | “危险”; red critical cards |

The synthetic fixtures deliberately use the same 70/40/20 bands for both cards to exercise their display paths. They do not change or verify deployed threshold configuration. Threshold alerts came from the existing evaluator. History was empty so this check does not assess populated usage charts.

## Evidence

The contact sheets below contain real browser screenshots, with a fixture label above each isolated viewport. Left to right, top to bottom: first failure; failed 70/40/20; stale 70/40/20; unknown; normal 80; fresh 70/40/20.

- [390px mobile-width screenshots](audit/browser-mobile-2026-10-29.jpg)
- [1440px desktop-width screenshots](audit/browser-desktop-2026-10-29.jpg)

The real browser work supplements the earlier VM consumer tests; those tests were not rerun. This check does not verify GitHub Pages deployment, live school responses, account authentication, real notifications, native mobile browser differences or populated chart interactions. The temporary server, tab, copied website and individual full-size screenshots were removed after verification; only these two contact sheets and this record remain.

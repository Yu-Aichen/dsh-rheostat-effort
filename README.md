# dsh-rheostat-effort

> 滑动变阻器推理档位控件 · a rheostat-style reasoning-effort slider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)
>
> 把模型**实际颁布**的档位铺到一条 0–30 强度轴上,拖动只预览、松手才提交;人物铺在界面右侧背景里,随档位切换。

```
[ ======●-------- ]  高 · #15
```

---

## 它做什么

- **跟随模型真实档位** —— 读 `reasoning.efforts`,不写死数量:2 档 → 0/30,3 档 → 0/15/30,5 档 → 0/8/15/23/30
- **提交的是原始 effort id** —— 视觉档位永不外发,发出去的永远是适配器认识的那个 id
- **拖动只预览,松手才提交** —— 拖动过程中零请求;键盘/滚轮也要等落定延时
- **24 张人像锚点铺满 0–30** —— 缺口档位(2/5/8/11/20/23/26)按两侧锚点交叉淡入,整条轴连续不跳变
- **人物在右侧背景** —— 整图 `cover` 放大铺满,自带影棚底色延伸到全屏;可调位置/缩放/底色
- **设置里一行开关** —— 「设置 → 通用设置 → 滑动变阻器」,一键回原生外观

## 安装

Web 与官方 Desktop 使用**独立的 profile**,装错 profile 不会生效。

```sh
# 官方 Desktop
dsh plugin --profile desktop add github:Yu-Aichen/dsh-rheostat-effort

# Web
dsh plugin --profile web add github:Yu-Aichen/dsh-rheostat-effort
```

装完**完全退出并重新打开** DSH(客户端 bundle 在启动时合成,刷新页面不够)。

本地目录安装(开发迭代):

```sh
dsh plugin --profile desktop add /path/to/dsh-rheostat-effort
```

卸载:

```sh
dsh plugin --profile desktop remove dsh-rheostat-effort
```

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖,不用改代码:

```yaml
- id: rheostat-effort
  name: 'dsh-rheostat-effort'
  config:
    backdropFocusX: 1        # 0..1  可视窗口的水平锚点,1 = 人物靠右
    backdropFocusY: 0.42     # 0..1  垂直锚点
    backdropZoom: 1          # >0    在 cover 之上的额外放大
    backdropOpacity: 0.92    # 0..1  人物相对自身底色的不透明度
    backdropColor: 'rgb(156 157 161)'   # 底层底色,默认是量出来的影棚灰
```

## 自备人物图(必读)

**本仓库不包含人物图片。** `assets/` 是空的,只有一个说明文件 —— 因为那些素材是真人照片,
而 MIT 只覆盖代码。

第一次运行前请放入 **24 张锚点图**,命名固定为 `intensity-NN.webp`:

```
intensity-00  intensity-01  intensity-03  intensity-04
intensity-06  intensity-07  intensity-09  intensity-10
intensity-12  intensity-13  intensity-14  intensity-15
intensity-16  intensity-17  intensity-18  intensity-19
intensity-21  intensity-22  intensity-24  intensity-25
intensity-27  intensity-28  intensity-29  intensity-30
```

- 这些是 `lib/logic.js` 里 `ANCHOR_LEVELS` 声明的锚点;**没有图的档位**(2/5/8/11/20/23/26)由两侧锚点交叉淡入
- 正方形图效果最好:背景用 `object-fit: cover` 放大,可视窗口锚在右侧,所以**人物大致居中**即可
- **不缺图也能跑**:缺哪张,那个锚点就退回相邻的已有帧;一张都没有时,背景只剩底色,滑轨与档位功能照常
- 宿主半边**每次启动重扫**该目录,换图不需要重新打包或改代码

```powershell
Copy-Item .\my-frames\*.webp .\assets\ -Force
```

> 请使用**你有权使用**的图片。本项目的 MIT 许可证不覆盖人物肖像、姓名、形象权或相关第三方权利,
> 详见 [LICENSE](LICENSE)。

## 构建与测试

`lib/client.js` 是**生成产物,不要手改**:

```
src/client/main.js + lib/logic.js  --(scripts/build-client.mjs)-->  lib/client.js
```

```sh
node scripts/build-client.mjs           # 生成
node scripts/build-client.mjs --check   # 产物与源文件不一致则退出 1
node --test test/logic.test.js test/render.test.js
```

产物必须是 DSH 的模块表形态 —— 这一步**不能省**:

```js
window.__ModuleLoader__.load({
  id: 'dsh-rheostat-effort',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    /* …模块体… */
    return module.exports          // 必须返回
  },
})
```

浏览器里的 `require` **只作为 factory 的参数存在**,相对 `require('./logic.js')` 也无法解析
(浏览器没有相对解析),所以纯逻辑是**内联**进产物的。裸 IIFE 调 `require` 会在导入时抛
`ReferenceError`,而后果是**整个 web boot 失败**、界面打不开 —— 不只是插件不生效。
测试里的加载器替身会真的调用 factory,所以包装一旦缺失,测试当场全红。

## 结构

```
dsh-rheostat-effort/
├─ src/index.mjs             宿主半边:把 assets/ 映射成 /plugins/dsh-rheostat-effort/assets/*,
│                            ETag / Range / HEAD,只认 intensity-NN.webp
├─ src/client/main.js        客户端源文件(改这里)
├─ lib/logic.js              纯逻辑:档位↔强度、锚点插值、背景色调(无 React、无 DOM)
├─ lib/client.js             浏览器产物(生成,勿手改)
├─ scripts/build-client.mjs  打包器:加加载器包装 + 内联逻辑 + --check
├─ assets/                   锚点图目录(空,自备;见上文)
├─ cordis.patch.yml          bundle 挂载行(id: rheostat-effort)
├─ test/logic.test.js        8 项:映射往返、插值、边界、色调单调性、图集校验(有图时才校验)
├─ test/render.test.js       40 项:产物形态、座位契约、渲染、拖动提交、键盘、开关、延迟接管
└─ test/harness.js           测试替身:模块加载器 + 按树位置保存 hook 的 React 替身
```

## 设计取舍(踩过的坑)

这份实现是照着 **DSH 0.2.0-rc.2 的真实运行时契约**写的,下面每条都是实际撞过的:

| 问题 | 结论 |
| --- | --- |
| 客户端 bundle 形态 | 必须有 `window.__ModuleLoader__.load` 包装,否则整个 web boot 失败 |
| `inject` 门控 | 用到的每个服务名都要在**同一个** `ctx.inject([...])` 里等过;漏一个就在读取时抛错 |
| 座位的 `inject` 面 | **返回 `null` 会崩渲染器**(`Cannot read properties of null (reading 'hooks')`) |
| 占用 `conversation.input.model` | `single` 座位,同优先级重复注册会抛错;而且**无法"优雅拒绝"** —— 所以本插件不占它 |
| 新会话没有模型目录 | `modelDirectories.directoryFor()` 对未建立 binding 的会话**直接抛错**,这是正常状态;控件挂载后持续重问,目录就绪再出现 |
| 副作用顺序 | 样式/背景/`console` 探针放在等服务和等目录**之前**,这样任何一环出问题都能用日志一刀切开 |

## 兼容性

- DSH **0.2.0-rc.2** 上开发与验证
- 只使用平台种子里的 `react`,不 `require` 任何其他 DSH 包(减少随版本失效的面)
- `dsh.client.platform: "web"`,Web 与 Desktop 的 Web 界面都适用

## 已知限制

- **人物图要靠你提供**:仓库不带素材(见上文),一张图都没有时背景只有底色,滑轨仍可正常使用
- **未做多标签同步**:偏好存在 Host 设置文档里,但同一时刻只有一个标签页在写
- 背景层是 `position: fixed` 的整屏层,若某个第三方皮肤也这么做,两者会叠加

## License

代码与文档:[MIT](LICENSE)。

**本仓库不包含任何人物图片。** `assets/` 由使用者自备,MIT 不覆盖其中素材,也不覆盖任何人的
肖像、姓名或形象权 —— 详见 [LICENSE](LICENSE)。

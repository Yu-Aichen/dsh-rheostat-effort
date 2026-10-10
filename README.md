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
dsh plugin --profile desktop add github:YOUR_NAME/dsh-rheostat-effort

# Web
dsh plugin --profile web add github:YOUR_NAME/dsh-rheostat-effort
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

## 换掉人物图

24 张锚点写在 `lib/logic.js` 的 `ANCHOR_LEVELS`,文件名规则由 `frameName()` 决定
(默认零填充两位)。把 `assets/intensity-NN.webp` 换成同名文件即可 —— 宿主半边每次启动重扫,
**不需要改代码或重新打包**。

```powershell
# 例如整批换图
Copy-Item .\my-frames\*.webp .\assets\ -Force
```

> 图片是可替换的**素材**,不是代码。见 [LICENSE](LICENSE) 的 Third-party portrait assets:
> MIT 只覆盖代码,不覆盖肖像。对外分发前请换成你有权使用的图。

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
├─ assets/                   24 张强度锚点 intensity-00 … intensity-30.webp
├─ cordis.patch.yml          bundle 挂载行(id: rheostat-effort)
├─ test/logic.test.js        8 项:映射往返、插值、边界、色调单调性、资源与锚点一一对应
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

- **未做多标签同步**:偏好存在 Host 设置文档里,但同一时刻只有一个标签页在写
- **人物图是可替换素材**,不是设计系统的一部分;换图是预期用法
- 背景层是 `position: fixed` 的整屏层,若某个第三方皮肤也这么做,两者会叠加

## License

代码与文档:[MIT](LICENSE)。
`assets/` 下的人像素材**不在 MIT 覆盖范围内**,详见 LICENSE。

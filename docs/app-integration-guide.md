# Animaku 原生 App 客户端接入与媒体直连播放协议手册

> **阅读对象提示**：本文档专门面向**负责开发 Animaku 移动端/桌面端客户端的大语言模型（LLM）与架构工程师**。
> 文档包含完整的接口契约、JSON Schema、平台隔离规范、直连播放协议以及针对主流播放器内核（Flutter `media_kit`/`libmpv`、Android `Media3`/`ExoPlayer`、iOS `AVPlayer` 等）的请求头（Headers）精确注入实现。

---

## 一、 架构原则与核心设计理念

### 1. 核心铁律：零服务器代理流量（Zero Server Bandwidth Principle）
* **Web 端的局限性**：浏览器受制于 W3C 同源策略（CORS）与 Referer 伪造限制，无法向第三方源站发送自定义请求头（如 `Referer`、`Cookie`），因此网页端在某些受控源上被迫退化为服务端代理（通过 `/api/media/stream` 中转）。
* **App 端的原生特权**：移动端与桌面端 App 拥有完整的系统网络套接字权限，**不受浏览器的 CORS 和 Referer 沙箱限制**。
* **App 接入铁律**：**App 端在解析出视频地址后，必须直接使用源站原始播放地址（`playUrl`）配合源站请求头（`headers`）直连播放！严禁在正常情况下使用服务端的代理流地址（`proxyUrl`）！** 服务端仅负责解析算子计算、Token 握手与 API 调度，不承担 App 端的媒体流量。

### 2. 视频源平台隔离与可见性契约（`platforms`）
* 规则定义中新增 `platforms?: ('web' | 'app')[]` 字段：
  * **缺省未配置**：默认为全平台支持（`['web', 'app']`）。
  * **`platforms: ['app']`**：**App 专属源**（在 Web 网页端完全隐藏）。
* **专属源典型代表**：
  * **`sorani`（青空次元）**：1080P 超清 HLS 流。源站 CDN（`sorani-vids.xyz`）强校验 `Referer: https://www.sorani.net/`，Web 端无法伪造，但在 App 原生播放器中注入 Referer 即可零带宽直连秒播。
  * **`anime1`（Anime1）**：720P/1080P MP4 直链。源站强依赖动态短效 `Cookie: e=...`，Web 端因跨域 Cookie 限制无法直连，但在 App 端注入 Cookie 即可原生直连起播。

---

## 二、 视频源规则系统（Plugin Rules）

### 1. 规则数据结构（TypeScript 定义）
```typescript
export interface PluginRule {
  name: string
  version: string
  baseURL: string
  weight?: number                     // 排序权重，越高越优先
  platforms?: ('web' | 'app')[]       // 支持平台，App 需加载包含 'app' 或未定义的规则
  requiresFullMediaProxy?: boolean    // Web 端全代理标记（App 端忽略）
  oldAnimePriority?: boolean          // 5 年以上老番场景额外赋予 +12 权重加权
  titlePreference?: 'chinese' | 'chinese_compact' | 'original' | 'traditional'
  // 其他抓取/解析配置
  searchURL?: string
  searchList?: string
  searchName?: string
  searchResult?: string
  chapterRoads?: string
  chapterResult?: string
  referer?: string
  adBlockerMode?: 'none' | 'client' | 'server'
}
```

### 2. App 端的规则加载逻辑
App 启动时，可通过本地预置或服务端下发获取内置规则集。App 端**必须**执行如下平台过滤：
```typescript
function getAppUsablePlugins(allRules: PluginRule[]): PluginRule[] {
  return allRules.filter(
    (rule) => !rule.platforms || rule.platforms.includes('app')
  )
}
```

---

## 三、 核心网络交互流程（API 契约）

App 与 Animaku 后端交互共经历三个核心阶段：**搜索（Search） ➔ 选集（Chapters） ➔ 播放解析（Resolve）**。

```
┌──────────────┐             ┌─────────────────────┐             ┌─────────────────────┐
│  Animaku App │             │  Animaku Backend    │             │  第三方视频源 / CDN  │
└──────┬───────┘             └──────────┬──────────┘             └──────────┬──────────┘
       │                                │                                   │
       │  1. POST /api/plugin/search    │                                   │
       ├───────────────────────────────>│ 抓取/解密三方搜索                 │
       │  { rule, keyword, bangumiId }  ├──────────────────────────────────>│
       │                                │<──────────────────────────────────┤
       │<───────────────────────────────┤                                   │
       │  返回 SearchItem[] 列表        │                                   │
       │                                │                                   │
       │  2. POST /api/plugin/chapters  │                                   │
       ├───────────────────────────────>│ 抓取/解析分集列表                 │
       │  { rule, sourceUrl }           ├──────────────────────────────────>│
       │                                │<──────────────────────────────────┤
       │<───────────────────────────────┤                                   │
       │  返回 Road[] (线路与集数列表)  │                                   │
       │                                │                                   │
       │  3. POST /api/plugin/resolve   │                                   │
       ├───────────────────────────────>│ 逆向/Token握手/获取媒体流         │
       │  { rule, pageUrl }             ├──────────────────────────────────>│
       │                                │<──────────────────────────────────┤
       │<───────────────────────────────┤                                   │
       │  返回 ResolvePlayResult        │                                   │
       │  (包含 playUrl 与 headers)     │                                   │
       │                                │                                   │
       │  4. 原生播放器直连播放（零服务器代理带宽）                        │
       │     setDataSource(playUrl, headers: result.headers)                │
       ├───────────────────────────────────────────────────────────────────>│
       │<───────────────────────────────────────────────────────────────────┤
       │  HTTP 200/206 媒体数据流（HLS / MP4）                             │
```

---

### 1. 搜索接口：`POST /api/plugin/search`
将当前选中的视频源规则（`rule`）与搜索词提交给后端进行跨域搜索与解析。

* **请求端点**：`POST /api/plugin/search`
* **Request Headers**：`Content-Type: application/json`
* **Request Body**：
```json
{
  "rule": {
    "name": "sorani",
    "version": "1.0",
    "baseURL": "https://www.sorani.net/",
    "platforms": ["app"]
  },
  "keyword": "葬送的芙莉莲",
  "bangumiId": 400602
}
```
* **Response Body**：
```json
{
  "data": {
    "pluginName": "sorani",
    "items": [
      {
        "name": "葬送的芙莉莲",
        "src": "https://www.sorani.net/anime/mal/828"
      },
      {
        "name": "葬送的芙莉莲 第二季",
        "src": "https://www.sorani.net/anime/mal/4489"
      }
    ],
    "diagnostics": ["青空次元搜索成功: 命中 2 部番剧"]
  }
}
```

---

### 2. 选集接口：`POST /api/plugin/chapters`
提交搜索选中的番剧页面地址（`source` 或 `sourceUrl`），获取播放线路与集数列表。

* **请求端点**：`POST /api/plugin/chapters`
* **Request Body**：
```json
{
  "rule": { "name": "sorani", "baseURL": "https://www.sorani.net/" },
  "source": "https://www.sorani.net/anime/mal/828"
}
```
* **Response Body**：
```json
{
  "data": {
    "pluginName": "sorani",
    "roads": [
      {
        "name": "青空次元 (1080P)",
        "identifier": ["第01集", "第02集", "第03集"],
        "data": [
          "https://www.sorani.net/anime/mal/828/episode/9604",
          "https://www.sorani.net/anime/mal/828/episode/9605",
          "https://www.sorani.net/anime/mal/828/episode/9606"
        ]
      }
    ]
  }
}
```

---

### 3. 播放直链解析接口：`POST /api/plugin/resolve`（★ 最核心）
提交具体某一集的页面地址（`pageUrl`），获取该源的源站真实直链与专属请求头。

* **请求端点**：`POST /api/plugin/resolve`
* **Request Body**：
```json
{
  "rule": {
    "name": "sorani",
    "baseURL": "https://www.sorani.net/",
    "platforms": ["app"],
    "requiresFullMediaProxy": false
  },
  "pageUrl": "https://www.sorani.net/anime/mal/828/episode/9604"
}
```
* **Response Body (ResolvePlayResult Schema)**：
```json
{
  "data": {
    "playUrl": "https://www.sorani-vids.xyz/videos/681f0603d01a8f5cfce1d322/9g9ceb/index.m3u8?counts=5&timestamp=1792184182294&key=f9ba2cbc2cfa4baeb821bf60dc5042f8",
    "proxyUrl": "/api/media/m3u8?url=...",
    "format": "hls",
    "contentType": "application/vnd.apple.mpegurl",
    "requiresProxy": false,
    "referer": "https://www.sorani.net/",
    "headers": {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
      "Referer": "https://www.sorani.net/"
    },
    "diagnostics": ["成功解析青空次元 1080P HLS 直链: https://..."]
  }
}
```

#### 关键字段行为契约说明：
| 字段名 | 类型 | App 端的处理动作 |
| :--- | :--- | :--- |
| **`playUrl`** | `string` | **必须作为视频源 URL 输入给播放器**（源站原始直链，MP4 或 M3U8）。 |
| **`headers`** | `Record<string, string>` | **必须提取并全量注入给播放器内核**。包含源站要求的 `Referer`、动态 `Cookie`、`User-Agent` 等。若不注入，CDN 会直接返回 403 Forbidden！ |
| **`format`** | `'hls' \| 'mp4'` | 播放器内核格式提示（`hls` 通常为 m3u8，`mp4` 为标准渐进式视频）。 |
| **`requiresProxy`** | `boolean` | 对于 App 直连源，服务端已置为 `false`。App 端忽略服务端媒体代理。 |
| **`proxyUrl`** | `string` | 服务端反代地址，**仅供 Web 浏览器兜底使用，App 端禁止使用**。 |

---

## 四、 各平台播放器内核 Headers 注入代码实现

必须确保将 `result.headers` 字典中的每一个 Key/Value 注入到播放器的 HTTP 请求栈中。

### 1. Flutter (`media_kit` / `libmpv`) —— 【官方推荐方案】
`media_kit` 底层基于 `libmpv`，支持在 `Media` 构造函数中使用 `http-header-fields` 注入自定义头部：

```dart
import 'package:media_kit/media_kit.dart';

Future<void> startPlayback({
  required Player player,
  required String playUrl,
  Map<String, String>? headers,
}) async {
  // 转换 headers 字典为 mpv 接受的逗号/换行分隔键值对格式
  final Map<String, String> httpHeaders = {};
  if (headers != null) {
    headers.forEach((key, value) {
      if (value.isNotEmpty) {
        httpHeaders[key] = value;
      }
    });
  }

  // 构造原生 Media 对象并挂载自定义请求头
  final media = Media(
    playUrl,
    httpHeaders: httpHeaders,
  );

  await player.open(media);
  await player.play();
}
```

### 2. Android 原生 (`Media3` / `ExoPlayer`)
通过自定义 `DefaultHttpDataSource.Factory` 注入全量请求头：

```kotlin
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

fun playVideo(
    player: ExoPlayer,
    playUrl: String,
    headers: Map<String, String>?
) {
    val httpDataSourceFactory = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)

    // 关键：注入服务端返回的直连防盗链与鉴权头（Referer, Cookie, UA）
    headers?.forEach { (key, value) ->
        httpDataSourceFactory.setDefaultRequestProperties(mapOf(key to value))
    }

    val mediaSourceFactory = DefaultMediaSourceFactory(httpDataSourceFactory)
    val mediaItem = MediaItem.fromUri(playUrl)

    val mediaSource = mediaSourceFactory.createMediaSource(mediaItem)
    player.setMediaSource(mediaSource)
    player.prepare()
    player.play()
}
```

### 3. iOS 原生 (`AVPlayer` / `AVURLAsset`)
通过 `AVURLAssetHTTPHeaderFieldsKey` 注入 headers：

```swift
import AVFoundation

func playVideo(player: AVPlayer, playUrl: String, headers: [String: String]?) {
    guard let url = URL(string: playUrl) else { return }

    var options: [String: Any] = [:]
    if let headers = headers, !headers.isEmpty {
        options["AVURLAssetHTTPHeaderFieldsKey"] = headers
    }

    let asset = AVURLAsset(url: url, options: options)
    let playerItem = AVPlayerItem(asset: asset)

    player.replaceCurrentItem(with: playerItem)
    player.play()
}
```

### 4. React Native (`react-native-video`)
```tsx
import Video from 'react-native-video';

interface PlaybackProps {
  playUrl: string;
  headers?: Record<string, string>;
}

export const NativePlayer: React.FC<PlaybackProps> = ({ playUrl, headers }) => {
  return (
    <Video
      source={{
        uri: playUrl,
        headers: headers || {},
      }}
      style={{ width: '100%', height: '100%' }}
      controls={true}
      resizeMode="contain"
    />
  );
};
```

---

## 五、 特殊视频源直连适配注意事项

在开发或配置具体源时，以下专有规则已在服务端完成逆向适配，但 App 端需要理解其直连工作机制：

### 1. `sorani`（青空次元 - 1080P HLS）
* **特征**：M3U8 播放列表包含 AES-128 加密 Key（`ts.key`）以及切片（`.ts`）。
* **安全门禁**：源站 CDN 强校验 `Referer: https://www.sorani.net/`。
* **现象与规避**：若未透传 Referer，拉取 `ts.key` 或分片时会抛出 `HTTP 403 Forbidden`。
* **正确做法**：将 `result.headers`（包含 `Referer: https://www.sorani.net/`）注入播放器，底层解密器在拉取 Key 和 TS 分片时会自动带上该 Referer，顺利解密播放。

### 2. `anime1`（Anime1 - 繁体 MP4）
* **特征**：动态短效防刷 Cookie 鉴权。
* **安全门禁**：播放直链必须携带服务端实时握手拿到的 `Cookie: e=...` 以及 `Referer: https://anime1.me/`。
* **正确做法**：服务端已将鉴权 Cookie 写入 `result.headers.Cookie`，App 播放器直接设置请求头发起连接即可。

### 3. `moonci`（月之祠 - 联通云盘直链 MP4）
* **特征**：源站为联通/移动网盘 CDN（如 `pan.wo.cn`）。
* **安全门禁**：**携带错误的 Referer 会报 `400 Bad Request`**！源站支持 `no-referrer`。
* **正确做法**：服务端返回的 `result.headers.Referer` 为空字符串或不含 Referer，App 保持遵循接口返回的 `headers` 即可，切勿自行盲目追加默认 Referer。

### 4. `lzizy`（量子资源 - 带有切片插播广告）
* **特征**：纯 HLS 直链，分片不校验 Referer。
* **广告现象**：源站自带 3~5 秒切片广告。
* **正确做法**：原生播放器直接播放是完全正常的。若 App 追求极致体验，未来可在客户端根据 TS 切片序列号断层（Discontinuity）逻辑进行跳过。

---

## 六、 错误排查与自愈决策树（Troubleshooting）

```
                     起播失败 (Playback Error)
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
          HTTP 403 Forbidden             HTTP 400 Bad Request
                 │                             │
    ┌────────────┴────────────┐                └─ 检查 Referer 是否违规追加
    ▼                         ▼                   (如联通云盘源需空 Referer)
排查 Referer 是否漏传   排查 Cookie 是否漏传
(如 sorani 需 sorani.net) (如 anime1 需 e=...)
```

1. **若遇到 `403 Forbidden`**：
   - 第一时间打印 App 发出的 HTTP 请求抓包日志。
   - 99% 的原因是播放器未将 `result.headers` 注入到底层网络栈（或者仅在加载主 M3U8 时注入，未在加载分片/Key 时继承请求头）。
2. **重试机制**：
   - 若直连在播放中途遭遇断流（例如某些 CDN 链接带有 1 小时动态有效期的 `timestamp` 和 `key`），触发自动自愈流程：重新调用 `POST /api/plugin/resolve` 换取新鲜直链后平滑恢复播放进度（Seek 到当前毫秒数）。

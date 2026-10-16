/**
 * sorani.net (青空次元) dedicated adapter.
 *
 * Architecture:
 * - Frontend: SvelteKit SPA (sorani.net)
 * - Backend: RESTful JSON API (api.sorani.cc/sorani-cms/api)
 * - Video CDN: High-bitrate 1080P HLS (AES-128 key) hosted on sorani-vids.xyz
 * - App-Exclusive Source (platforms: ['app']):
 *   源站 CDN (sorani-vids.xyz) 强校验白名单 Referer (https://www.sorani.net/)，空 Referer 或跨域 Origin 报 403。
 *   浏览器在 Web 端因安全沙箱无法伪造跨域 Referer，但在 App 原生播放器中可直接携带 Referer 直连，
 *   实现 1080P 零服务器代理带宽直连播放。
 */
import type {
  PluginChapterResult,
  PluginRule,
  PluginSearchResult,
  ResolvePlayResult,
  Road,
  SearchItem,
} from '@animaku/shared'
import { config } from '../config'
import { assertPublicHttpUrl, fetchPublic } from './private-host'

export const SORANI_WEB_BASE = 'https://www.sorani.net'
export const SORANI_API_BASE = 'https://api.sorani.cc/sorani-cms/api'
export const SORANI_REFERER = 'https://www.sorani.net/'
export const SORANI_ORIGIN = 'https://www.sorani.net'

export function isSoraniRule(rule: PluginRule): boolean {
  const name = (rule.name || '').toLowerCase().trim()
  if (
    name === 'sorani' ||
    name === 'sorani_net' ||
    name === 'soraninet' ||
    name === '青空' ||
    name === '青空次元'
  ) {
    return true
  }
  const base = (rule.baseURL || '').toLowerCase()
  return (
    base.includes('sorani.net') ||
    base.includes('sorani.cc') ||
    base.includes('sorani.org')
  )
}

function getBaseHeaders(): Record<string, string> {
  return {
    'User-Agent': config.defaultUserAgent,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: SORANI_REFERER,
    Origin: SORANI_ORIGIN,
  }
}

interface SoraniSearchRecord {
  id: number
  title: string
  bangumiId?: number
  alias?: string
  cover?: string
  episodeCount?: number
  statusText?: string
}

interface SoraniSearchResponse {
  code: number
  msg?: string
  message?: string
  data?: {
    records?: SoraniSearchRecord[]
    total?: number
  }
}

/**
 * 1. 搜索番剧
 */
export async function searchSorani(
  rule: PluginRule,
  keyword: string,
): Promise<PluginSearchResult> {
  const trimmed = keyword.trim()
  if (!trimmed) {
    return { pluginName: rule.name, items: [], diagnostics: ['缺少搜索关键词'] }
  }

  const diagnostics: string[] = []
  const searchUrl = `${SORANI_API_BASE}/video?page=1&size=50&keyword=${encodeURIComponent(
    trimmed,
  )}&enabled=true&sortMode=relevance_popular&sortDesc=true`

  try {
    assertPublicHttpUrl(searchUrl, '青空次元搜索 API')
    const res = await fetchPublic(
      searchUrl,
      {
        method: 'GET',
        headers: getBaseHeaders(),
      },
      { timeoutMs: 12_000, source: 'sorani' },
    )

    if (!res.ok) {
      throw new Error(`青空次元搜索 HTTP ${res.status}: ${res.statusText}`)
    }

    const json = (await res.json()) as SoraniSearchResponse
    if (json.code !== 200) {
      return {
        pluginName: rule.name,
        items: [],
        diagnostics: [`搜索失败: ${json.message || json.msg || '异常代码'}`],
      }
    }

    const records = json.data?.records || []
    const items: SearchItem[] = records.map((item) => ({
      name: item.title?.trim() || `番剧 #${item.id}`,
      src: `${SORANI_WEB_BASE}/anime/mal/${item.id}`,
    }))

    diagnostics.push(`青空次元搜索成功: 命中 ${items.length} 部番剧`)
    return {
      pluginName: rule.name,
      items,
      diagnostics,
    }
  } catch (err) {
    return {
      pluginName: rule.name,
      items: [],
      diagnostics: [err instanceof Error ? err.message : String(err)],
    }
  }
}

export function extractSoraniVideoId(source: string): number | null {
  const trimmed = source.trim()
  const match =
    trimmed.match(/\/anime\/(?:mal\/)?(\d+)/i) ||
    trimmed.match(/\/video\/(\d+)/i)
  if (match) return Number(match[1])
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return null
}

interface SoraniEpisodeItem {
  episodeId: number
  videoId: number
  title?: string
  episodeLabel?: string
  episodeOrder?: number
}

interface SoraniDetailResponse {
  code: number
  message?: string
  data?: {
    id: number
    title: string
    episodes?: SoraniEpisodeItem[]
  }
}

/**
 * 2. 获取分集列表
 */
export async function chaptersSorani(
  rule: PluginRule,
  source: string,
): Promise<PluginChapterResult> {
  const videoId = extractSoraniVideoId(source)
  if (!videoId) {
    return {
      pluginName: rule.name,
      roads: [],
      diagnostics: [`无法从输入中提取青空次元 videoId: ${source}`],
    }
  }

  const diagnostics: string[] = []
  const detailUrl = `${SORANI_API_BASE}/video/${videoId}`

  try {
    assertPublicHttpUrl(detailUrl, '青空次元番剧详情 API')
    const res = await fetchPublic(
      detailUrl,
      {
        method: 'GET',
        headers: getBaseHeaders(),
      },
      { timeoutMs: 12_000, source: 'sorani' },
    )

    if (!res.ok) {
      throw new Error(`青空次元详情 HTTP ${res.status}: ${res.statusText}`)
    }

    const json = (await res.json()) as SoraniDetailResponse
    if (json.code !== 200) {
      throw new Error(`青空次元详情响应异常: ${json.message || '未知错误'}`)
    }

    const epList = json.data?.episodes || []
    if (epList.length === 0) {
      return {
        pluginName: rule.name,
        roads: [],
        diagnostics: ['番剧暂无可用剧集'],
      }
    }

    // 默认按集数自然顺序升序排列
    const sorted = [...epList].sort(
      (a, b) => (a.episodeOrder ?? 0) - (b.episodeOrder ?? 0),
    )

    const data = sorted.map(
      (ep) => `${SORANI_WEB_BASE}/anime/mal/${videoId}/episode/${ep.episodeId}`,
    )
    const identifier = sorted.map(
      (ep) => (ep.episodeLabel || ep.title || `第${ep.episodeOrder ?? ''}集`).trim(),
    )

    const roads: Road[] = [
      {
        name: '青空次元 (1080P)',
        data,
        identifier,
      },
    ]

    diagnostics.push(`青空次元选集成功: 共 ${data.length} 集`)
    return {
      pluginName: rule.name,
      roads,
      diagnostics,
    }
  } catch (err) {
    return {
      pluginName: rule.name,
      roads: [],
      diagnostics: [err instanceof Error ? err.message : String(err)],
    }
  }
}

export function extractSoraniEpisodeId(pageUrl: string): number | null {
  const trimmed = pageUrl.trim()
  const match = trimmed.match(/\/episode\/(\d+)/i)
  if (match) return Number(match[1])
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return null
}

interface SoraniPlayResponse {
  code: number
  message?: string
  data?: {
    canPlay?: boolean
    playUrl?: string
    message?: string
    hls?: boolean
  }
}

/**
 * 3. 播放直链解析
 */
export async function resolveSorani(
  rule: PluginRule,
  pageUrl: string,
): Promise<ResolvePlayResult> {
  const episodeId = extractSoraniEpisodeId(pageUrl)
  if (!episodeId) {
    throw new Error(`无法从输入中提取青空次元 episodeId: ${pageUrl}`)
  }

  // 必须携带 Referer 和 Origin，否则青空次元 API 会拦截返回“请求来源不受信任”
  const playApiUrl = `${SORANI_API_BASE}/video/episode/${episodeId}/play`
  assertPublicHttpUrl(playApiUrl, '青空次元播放解析 API')

  const res = await fetchPublic(
    playApiUrl,
    {
      method: 'GET',
      headers: getBaseHeaders(),
    },
    { timeoutMs: 12_000, source: 'sorani' },
  )

  if (!res.ok) {
    throw new Error(`青空次元播放解析 HTTP ${res.status}: ${res.statusText}`)
  }

  const json = (await res.json()) as SoraniPlayResponse
  if (json.code !== 200) {
    throw new Error(`青空次元播放解析失败: ${json.message || '未知错误'}`)
  }

  if (json.data?.canPlay === false || !json.data?.playUrl) {
    throw new Error(
      json.data?.message || '青空次元未开放当前集数播放权限或播放地址为空',
    )
  }

  const rawPlayUrl = json.data.playUrl.trim()
  const proxyUrl = `/api/media/m3u8?${new URLSearchParams({
    url: rawPlayUrl,
    referer: SORANI_REFERER,
  }).toString()}`

  // 特殊处理说明：
  // 源站 CDN (sorani-vids.xyz) 针对 m3u8 切片和 ts.key 实施了严格的 Referer 防盗链白名单检查，
  // 空 Referer 或跨域 Referer 必定报 403 Forbidden。
  // 因此对外下发的 headers 中必须明确附带 Referer: https://www.sorani.net/，
  // App 原生播放器加载该直链时带上此 Referer 即可直接 0 代理流量秒开播放。
  return {
    playUrl: rawPlayUrl,
    proxyUrl,
    format: 'hls',
    contentType: 'application/vnd.apple.mpegurl',
    requiresProxy: false,
    referer: SORANI_REFERER,
    headers: {
      'User-Agent': config.defaultUserAgent,
      Referer: SORANI_REFERER,
    },
    diagnostics: [`成功解析青空次元 1080P HLS 直链: ${rawPlayUrl}`],
  }
}

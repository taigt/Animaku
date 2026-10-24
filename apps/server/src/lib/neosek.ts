/**
 * neosek.ai (neosek) dedicated adapter.
 *
 * 注意 / 特殊限制说明：
 * 该站部署了地区封锁策略，明确禁用了日本地区 IP (Ban Japan IP)，
 * 请求与部署时请确保出站节点非日本 IP，否则将导致网络握手被阻断或接口返回异常。
 *
 * neosek.ai 搜索分类参数说明 (Search Category Parameter):
 * - 全部: GET https://neosek.ai/api/v1/search?q={keyword}
 *   (不传递 content_type，同时检索动画、漫画、同人志、图集等全站资源)
 * - 漫画: GET https://neosek.ai/api/v1/search?q={keyword}&content_type=manga
 *   (仅检索漫画、同人志、图集资源)
 * - 动画: GET https://neosek.ai/api/v1/search?q={keyword}&content_type=anime
 *   (本次接入所使用的参数：严格过滤非动画资源，仅检索动画番剧 TV/剧场版/OAD)
 */
import {
  extractBaseTitle,
  type PluginChapterResult,
  type PluginRule,
  type PluginSearchResult,
  type ResolvePlayResult,
  type Road,
  type SearchItem,
} from '@animaku/shared'
import { config } from '../config'
import { assertPublicHttpUrl, fetchPublic } from './private-host'

const NEOSEK_BASE_URL = 'https://neosek.ai'

export function isNeosekRule(rule: PluginRule): boolean {
  const name = (rule.name || '').toLowerCase().trim()
  if (name === 'neosek' || name === 'neosekai') {
    return true
  }
  const base = (rule.baseURL || '').toLowerCase()
  return base.includes('neosek.ai')
}

function getBaseHeaders(referer?: string): Record<string, string> {
  return {
    'User-Agent': config.defaultUserAgent,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(referer ? { Referer: referer } : { Referer: `${NEOSEK_BASE_URL}/` }),
  }
}

interface NeosekSearchResponse {
  code?: number
  message?: string
  data?: {
    total?: number
    items?: Array<{
      id: number
      content_type?: string
      title?: string
    }>
  }
}

interface NeosekUnitsResponse {
  code?: number
  message?: string
  data?: {
    items?: Array<{
      id: number
      work_id?: number
      sort: number
      title?: string
    }>
  }
}

interface NeosekUnitItemsResponse {
  code?: number
  message?: string
  data?: {
    items?: Array<{
      id: number
      video?: {
        container?: string
        hls?: {
          url?: string
          fallbacks?: string[]
        }
        original?: {
          url?: string
          fallbacks?: string[]
        }
      }
    }>
  }
}

function extractWorkId(source: string): string | null {
  const trimmed = source.trim()
  const m = trimmed.match(/\/anime\/(\d+)/i) || trimmed.match(/^(\d+)$/)
  return m ? m[1] : null
}

function extractUnitId(pageUrl: string): string | null {
  const trimmed = pageUrl.trim()
  const m = trimmed.match(/\/anime\/\d+\/(\d+)/i) || trimmed.match(/^(\d+)$/)
  return m ? m[1] : null
}

/**
 * 1. 搜索番剧
 *
 * neosek.ai 搜索分类参数说明 (Search Category Parameter):
 * - 全部: GET https://neosek.ai/api/v1/search?q={keyword}
 * - 漫画: GET https://neosek.ai/api/v1/search?q={keyword}&content_type=manga
 * - 动画: GET https://neosek.ai/api/v1/search?q={keyword}&content_type=anime (本次接入使用)
 */
export async function searchNeosek(
  rule: PluginRule,
  keyword: string,
): Promise<PluginSearchResult> {
  const trimmed = keyword.trim()
  if (!trimmed) {
    return { pluginName: rule.name, items: [] }
  }

  const queriesToTry = [trimmed]
  const stripped = extractBaseTitle(trimmed)
  if (stripped && stripped !== trimmed) {
    queriesToTry.push(stripped)
  }

  const items: SearchItem[] = []
  const seenIds = new Set<number>()

  for (const q of queriesToTry) {
    // 采用 content_type=anime 精准过滤非动画内容（图集/同人志）
    const searchUrl = `${NEOSEK_BASE_URL}/api/v1/search?q=${encodeURIComponent(q)}&content_type=anime`
    assertPublicHttpUrl(searchUrl, 'Neosek Search')

    try {
      const res = await fetchPublic(
        searchUrl,
        {
          headers: getBaseHeaders(`${NEOSEK_BASE_URL}/`),
        },
        { source: 'neosekai', timeoutMs: 10_000 },
      )

      if (!res.ok) continue

      const json = (await res.json()) as NeosekSearchResponse
      if (json.code !== 0 || !Array.isArray(json.data?.items)) continue

      for (const item of json.data.items) {
        if (!item.id || seenIds.has(item.id)) continue
        const title = (item.title || '').trim()
        if (!title) continue

        seenIds.add(item.id)
        items.push({
          name: title,
          src: `${NEOSEK_BASE_URL}/anime/${item.id}`,
        })
      }

      if (items.length > 0) break
    } catch {
      // 容错降级重试下一轮 query
    }
  }

  return {
    pluginName: rule.name,
    items,
  }
}

/**
 * 2. 获取分集列表
 */
export async function chaptersNeosek(
  rule: PluginRule,
  source: string,
): Promise<PluginChapterResult> {
  const workId = extractWorkId(source)
  if (!workId) {
    return {
      pluginName: rule.name,
      roads: [],
      diagnostics: [`无法从链接解析番剧 ID: ${source}`],
    }
  }

  const unitsUrl = `${NEOSEK_BASE_URL}/api/v1/works/${workId}/units`
  assertPublicHttpUrl(unitsUrl, 'Neosek Units')

  try {
    const res = await fetchPublic(
      unitsUrl,
      {
        headers: getBaseHeaders(`${NEOSEK_BASE_URL}/anime/${workId}`),
      },
      { source: 'neosekai', timeoutMs: 10_000 },
    )

    if (!res.ok) {
      return {
        pluginName: rule.name,
        roads: [],
        diagnostics: [`Neosek units API 返回 HTTP ${res.status}`],
      }
    }

    const json = (await res.json()) as NeosekUnitsResponse
    if (json.code !== 0 || !Array.isArray(json.data?.items)) {
      return {
        pluginName: rule.name,
        roads: [],
        diagnostics: [`Neosek units 数据格式异常: ${json.message || '未知错误'}`],
      }
    }

    const urls: string[] = []
    const identifiers: string[] = []
    for (const u of json.data.items) {
      urls.push(`${NEOSEK_BASE_URL}/anime/${workId}/${u.id}`)
      identifiers.push((u.title || `第 ${u.sort + 1} 话`).trim())
    }

    const road: Road = {
      name: 'Neosek',
      data: urls,
      identifier: identifiers,
    }

    return {
      pluginName: rule.name,
      roads: [road],
      diagnostics: [`成功解析 ${urls.length} 集`],
    }
  } catch (e) {
    return {
      pluginName: rule.name,
      roads: [],
      diagnostics: [e instanceof Error ? e.message : String(e)],
    }
  }
}

/**
 * 3. 解析播放地址
 */
export async function resolveNeosek(
  rule: PluginRule,
  pageUrl: string,
): Promise<ResolvePlayResult> {
  const unitId = extractUnitId(pageUrl)
  if (!unitId) {
    throw new Error(`无法从播放页链接解析单集 ID: ${pageUrl}`)
  }

  const itemsUrl = `${NEOSEK_BASE_URL}/api/v1/units/${unitId}/items`
  assertPublicHttpUrl(itemsUrl, 'Neosek Unit Items')

  const res = await fetchPublic(
    itemsUrl,
    {
      headers: getBaseHeaders(`${NEOSEK_BASE_URL}/anime/0/${unitId}`),
    },
    { source: 'neosekai', timeoutMs: 10_000 },
  )

  if (!res.ok) {
    throw new Error(`Neosek items API 返回 HTTP ${res.status}`)
  }

  const json = (await res.json()) as NeosekUnitItemsResponse
  if (json.code !== 0 || !Array.isArray(json.data?.items) || json.data.items.length === 0) {
    throw new Error(`Neosek 未返回有效视频项: ${json.message || '空数据'}`)
  }

  const videoItem = json.data.items[0]
  const originalUrl = videoItem?.video?.original?.url
  const hlsUrl = videoItem?.video?.hls?.url

  // 特殊处理说明：
  // 若原站提供有独立 mp4 原画直链，优先以 mp4 交付；否则回退 hls 直链
  const isDirectMp4 = Boolean(originalUrl && originalUrl.toLowerCase().includes('.mp4'))
  const playUrl = isDirectMp4 ? originalUrl! : (hlsUrl || originalUrl)

  if (!playUrl) {
    throw new Error('未获取到有效播放直链')
  }

  const isHls = playUrl.includes('.m3u8')
  return {
    playUrl,
    proxyUrl: isHls ? `/api/media/m3u8?url=${encodeURIComponent(playUrl)}` : `/api/media/proxy?url=${encodeURIComponent(playUrl)}`,
    format: isHls ? 'hls' : 'mp4',
    contentType: isHls ? 'application/vnd.apple.mpegurl' : 'video/mp4',
    referer: `${NEOSEK_BASE_URL}/`,
    headers: {
      'User-Agent': config.defaultUserAgent,
      Referer: `${NEOSEK_BASE_URL}/`,
    },
    diagnostics: [`成功解析 neosek 直链: ${playUrl}`],
  }
}

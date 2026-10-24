/**
 * neosek.ai (neosek) SourceAdapter
 *
 * 注意 / 特殊限制说明：
 * 该站部署了地区封锁策略，明确禁用了日本地区 IP (Ban Japan IP)，
 * 请求与部署时请确保出站节点非日本 IP，否则将导致网络握手被阻断或接口返回异常。
 */
import type { PluginRule } from '@animaku/shared'
import {
  searchNeosek,
  chaptersNeosek,
  resolveNeosek,
} from '../../neosek'
import type { SourceAdapter, RawResolveResult } from '../source-types'

const NEOSEK_RULE: PluginRule = {
  name: 'neosek',
  version: '1.0.0',
  baseURL: 'https://neosek.ai',
}

export const neosekAdapter: SourceAdapter = {
  id: 'neosekai',
  name: 'neosek',
  tier: 'tier_a',
  capabilities: {
    // 放行 Cloudflare 备用端口 2096 与 8443
    allowedPorts: [80, 443, 2096, 8443],
  },
  async search(keyword: string) {
    return searchNeosek(NEOSEK_RULE, keyword)
  },
  async chapters(source: string) {
    return chaptersNeosek(NEOSEK_RULE, source)
  },
  async resolve(pageUrl: string): Promise<RawResolveResult> {
    const res = await resolveNeosek(NEOSEK_RULE, pageUrl)
    return {
      mediaUrl: res.playUrl,
      publicHeaders: res.headers,
      format: 'hls',
    }
  },
}

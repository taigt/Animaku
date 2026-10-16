import type { PluginRule } from '@animaku/shared'
import {
  searchSorani,
  chaptersSorani,
  resolveSorani,
  SORANI_WEB_BASE,
} from '../../sorani'
import type { SourceAdapter, RawResolveResult } from '../source-types'

const SORANI_RULE: PluginRule = {
  name: 'sorani',
  version: '1.0.0',
  baseURL: SORANI_WEB_BASE,
  platforms: ['app'],
  requiresFullMediaProxy: false,
}

export const soraniAdapter: SourceAdapter = {
  id: 'sorani',
  name: '青空次元',
  tier: 'tier_a',
  capabilities: {
    allowedHosts: ['sorani-vids.xyz', 'www.sorani-vids.xyz'],
  },
  async search(keyword: string) {
    return searchSorani(SORANI_RULE, keyword)
  },
  async chapters(source: string) {
    return chaptersSorani(SORANI_RULE, source)
  },
  async resolve(pageUrl: string): Promise<RawResolveResult> {
    const res = await resolveSorani(SORANI_RULE, pageUrl)
    return {
      mediaUrl: res.playUrl,
      publicHeaders: res.headers,
      credentials: undefined,
      format: 'hls',
    }
  },
}

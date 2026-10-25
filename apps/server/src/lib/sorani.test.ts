import test from 'node:test'
import assert from 'node:assert/strict'
import type { PluginRule } from '@animaku/shared'
import {
  isSoraniRule,
  extractSoraniVideoId,
  extractSoraniEpisodeId,
  SORANI_REFERER,
} from './sorani'
import { wrapResolveWithTicket } from '../rule-engine'
import { soraniAdapter } from './source/adapters/sorani'
import { sourceRegistry } from './source/source-registry'
import { ALL_BUILTIN_PLUGIN_RULES, DEFAULT_PLUGIN_RULES } from '../../../web/src/data/default-plugins'

test('sorani: isSoraniRule matches rules correctly', () => {
  const rule1: PluginRule = {
    name: 'sorani',
    baseURL: 'https://www.sorani.net/',
    version: '1.0',
  }
  assert.equal(isSoraniRule(rule1), true)

  const rule2: PluginRule = {
    name: '青空次元',
    baseURL: 'https://example.com/',
    version: '1.0',
  }
  assert.equal(isSoraniRule(rule2), true)

  const rule3: PluginRule = {
    name: 'custom',
    baseURL: 'https://api.sorani.cc/',
    version: '1.0',
  }
  assert.equal(isSoraniRule(rule3), true)

  const otherRule: PluginRule = {
    name: 'cycani',
    baseURL: 'https://www.cycani.org/',
    version: '1.0',
  }
  assert.equal(isSoraniRule(otherRule), false)
})

test('sorani: ID extraction helpers work robustly', () => {
  assert.equal(extractSoraniVideoId('https://www.sorani.net/anime/mal/828'), 828)
  assert.equal(extractSoraniVideoId('https://www.sorani.net/anime/828'), 828)
  assert.equal(extractSoraniVideoId('https://www.sorani.net/anime/mal/50410?id=828'), 828)
  assert.equal(extractSoraniVideoId('https://www.sorani.net/anime/50410?videoId=828'), 828)
  assert.equal(extractSoraniVideoId('/video/4489'), 4489)
  assert.equal(extractSoraniVideoId('828'), 828)
  assert.equal(extractSoraniVideoId('invalid_string'), null)

  assert.equal(
    extractSoraniEpisodeId('https://www.sorani.net/anime/mal/828/episode/9604'),
    9604,
  )
  assert.equal(
    extractSoraniEpisodeId('https://www.sorani.net/anime/mal/828/episode/01?epId=9604'),
    9604,
  )
  assert.equal(
    extractSoraniEpisodeId('https://www.sorani.net/anime/mal/828/episode/02?episodeId=9605'),
    9605,
  )
  assert.equal(extractSoraniEpisodeId('/episode/12345'), 12345)
  assert.equal(extractSoraniEpisodeId('9604'), 9604)
  assert.equal(extractSoraniEpisodeId(''), null)
})

test('sorani: SourceRegistry recognizes sorani adapter and egress policy', () => {
  const adapter = sourceRegistry.getAdapter('sorani')
  assert.ok(adapter)
  assert.equal(adapter?.id, 'sorani')
  assert.equal(adapter?.name, '青空次元')

  // 别名匹配测试
  assert.equal(sourceRegistry.getAdapter('青空次元')?.id, 'sorani')
  assert.equal(sourceRegistry.getAdapter('sorani_net')?.id, 'sorani')

  // Egress 策略检查
  const egressOk = sourceRegistry.validateEgress(
    'https://www.sorani-vids.xyz/videos/123/index.m3u8',
    'sorani',
  )
  assert.equal(egressOk.valid, true)
})

test('sorani: wrapResolveWithTicket correctly treats sorani as App Direct source', () => {
  const rule: PluginRule = {
    name: 'sorani',
    baseURL: 'https://www.sorani.net/',
    platforms: ['app'],
    requiresFullMediaProxy: false,
    version: '1.0',
  }

  const resolveOutput = {
    playUrl: 'https://www.sorani-vids.xyz/videos/681f0603d01a8f5cfce1d322/9g9ceb/index.m3u8?key=abc',
    proxyUrl: '/api/media/m3u8?url=test',
    format: 'hls' as const,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: SORANI_REFERER,
    },
  }

  const wrapped = wrapResolveWithTicket(rule, resolveOutput)
  assert.equal(wrapped.requiresProxy, false)
  assert.equal(wrapped.playUrl, resolveOutput.playUrl)
  assert.ok(wrapped.headers)
  assert.equal(wrapped.headers.Referer, SORANI_REFERER)
})

test('sorani: default-plugins isolation between web and app', () => {
  // ALL_BUILTIN_PLUGIN_RULES 包含 sorani 与 anime1
  const allNames = ALL_BUILTIN_PLUGIN_RULES.map((r) => r.name)
  assert.ok(allNames.includes('sorani'))
  assert.ok(allNames.includes('anime1'))

  // DEFAULT_PLUGIN_RULES 针对 Web 端，严格过滤排除纯 App 平台源
  const webNames = DEFAULT_PLUGIN_RULES.map((r) => r.name)
  assert.equal(webNames.includes('sorani'), false)
  assert.equal(webNames.includes('anime1'), false)
  assert.ok(webNames.includes('cycani'))
  assert.ok(webNames.includes('lzizy'))
})

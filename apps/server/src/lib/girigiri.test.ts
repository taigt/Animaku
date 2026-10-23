import test from 'node:test'
import assert from 'node:assert/strict'
import type { PluginRule } from '@animaku/shared'
import {
  isGirigiriRule,
  extractVodId,
  formatGirigiriRoadName,
  parseGirigiriRoads,
  resolveGirigiri,
} from './girigiri'

test('girigiri: isGirigiriRule matches rules correctly', () => {
  const dummyRule: PluginRule = {
    name: 'girigiri',
    baseURL: 'https://ani.girigirilove.com/',
    version: '1.2',
  }
  assert.equal(isGirigiriRule(dummyRule), true)

  const cnRule: PluginRule = {
    name: 'girigiri愛動漫',
    baseURL: 'https://ani.girigirilove.com/',
    version: '1.2',
  }
  assert.equal(isGirigiriRule(cnRule), true)

  const domainRule: PluginRule = {
    name: 'custom',
    baseURL: 'https://ani.girigirilove.com/',
    version: '1.2',
  }
  assert.equal(isGirigiriRule(domainRule), true)

  const otherRule: PluginRule = {
    name: 'cycani',
    baseURL: 'https://cycani.org/',
    version: '1.0',
  }
  assert.equal(isGirigiriRule(otherRule), false)
})

test('girigiri: extractVodId handles various detail, play and legacy URL formats', () => {
  // 1. 新版 SPA 详情页
  assert.equal(
    extractVodId('https://ani.girigirilove.com/detail/26868'),
    '26868',
  )
  assert.equal(extractVodId('/detail/26868'), '26868')

  // 2. 新版 SPA 播放页
  assert.equal(
    extractVodId(
      'https://ani.girigirilove.com/play/26868?sourceIndex=0&episodeIndex=0',
    ),
    '26868',
  )

  // 3. 旧版 MacCMS 页面 URL
  assert.equal(extractVodId('https://ani.girigirilove.com/GV26868/'), '26868')
  assert.equal(
    extractVodId('https://ani.girigirilove.com/playGV26868-1-1/'),
    '26868',
  )

  // 4. API URL 与纯数字 ID
  assert.equal(
    extractVodId(
      'https://m3u8.girigirilove.com/api.php/Vod/get_detail?vod_id=26868',
    ),
    '26868',
  )
  assert.equal(extractVodId('26868'), '26868')
  assert.equal(extractVodId('invalid_url_without_id'), null)
})

test('girigiri: formatGirigiriRoadName converts abbreviations to friendly titles', () => {
  assert.equal(formatGirigiriRoadName('cht', 0), '繁体')
  assert.equal(formatGirigiriRoadName('chs', 1), '简体')
  assert.equal(formatGirigiriRoadName('DB', 2), '杜比视界')
  assert.equal(formatGirigiriRoadName('1080P', 3), '1080P超清')
  assert.equal(formatGirigiriRoadName('4K', 4), '4K超清')
  assert.equal(formatGirigiriRoadName('其他线路', 5), '其他线路')
  assert.equal(formatGirigiriRoadName('', 0), '默认线路')
})

test('girigiri: parseGirigiriRoads correctly parses multi-source playlists', () => {
  const playFrom = 'cht$$$chs'
  const playUrl =
    '先行01$https://akua.girigirilove.com/01/playlist.m3u8#02$https://akua.girigirilove.com/02/playlist.m3u8$$$01$https://akua.girigirilove.com/chs/01/playlist.m3u8#02$https://akua.girigirilove.com/chs/02/playlist.m3u8'

  const roads = parseGirigiriRoads(playFrom, playUrl)
  assert.equal(roads.length, 2)

  // Road 1 (繁体)
  assert.equal(roads[0]?.name, '繁体')
  assert.equal(roads[0]?.identifier.length, 2)
  assert.equal(roads[0]?.identifier[0], '先行01')
  assert.equal(roads[0]?.identifier[1], '第02集')
  assert.equal(
    roads[0]?.data[0],
    'https://akua.girigirilove.com/01/playlist.m3u8',
  )
  assert.equal(
    roads[0]?.data[1],
    'https://akua.girigirilove.com/02/playlist.m3u8',
  )

  // Road 2 (简体)
  assert.equal(roads[1]?.name, '简体')
  assert.equal(roads[1]?.identifier.length, 2)
  assert.equal(roads[1]?.identifier[0], '第01集')
  assert.equal(roads[1]?.identifier[1], '第02集')
  assert.equal(
    roads[1]?.data[0],
    'https://akua.girigirilove.com/chs/01/playlist.m3u8',
  )
})

test('girigiri: resolveGirigiri immediately resolves m3u8 direct links without roundtrip', async () => {
  const rule: PluginRule = {
    name: 'girigiri',
    baseURL: 'https://ani.girigirilove.com/',
    version: '1.2',
  }
  const streamUrl =
    'https://akua.girigirilove.com/zijian/oldanime/2026/04/cht/JoJosBizarreAdventureS6CHT/01/playlist.m3u8'

  const result = await resolveGirigiri(rule, streamUrl)
  assert.equal(result.playUrl, streamUrl)
  assert.equal(result.format, 'hls')
  assert.equal(result.requiresProxy, false)
  assert.ok(result.proxyUrl.includes('/api/media/m3u8?'))
  assert.ok(result.headers?.['User-Agent'])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTvTFun, chaptersTvTFun, resolveTvTFun } from './tvtfun'

const TVTFUN_RULE = {
  name: 'tvtfun',
  version: '2.0.0',
  baseURL: 'https://www.tvtfun.net',
}

test('tvtfun: search, chapters clustering, and direct stream resolve (Nuxt 3)', async () => {
  // 1. 验证搜索
  const searchResult = await searchTvTFun(TVTFUN_RULE, '鬼灭')
  assert.ok(searchResult.items.length > 0)
  assert.ok(searchResult.items[0].src.includes('/anime/'))

  // 2. 验证分集与线路聚类
  const target = searchResult.items.find((i) => i.name.includes('柱训练篇')) || searchResult.items[0]
  const chapterResult = await chaptersTvTFun(TVTFUN_RULE, target.src)
  assert.ok(chapterResult.roads.length > 0)

  const firstRoad = chapterResult.roads[0]
  assert.ok(firstRoad.data.length > 0)
  assert.ok(firstRoad.identifier.length > 0)

  // 3. 验证直链解析
  const firstEpUrl = firstRoad.data[0]
  const resolved = await resolveTvTFun(TVTFUN_RULE, firstEpUrl)
  assert.ok(resolved.playUrl.startsWith('http'))
  assert.ok(resolved.headers?.Referer?.includes('tvtfun.net'))
})

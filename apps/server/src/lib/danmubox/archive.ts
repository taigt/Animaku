import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  matchBestEpisodeXml,
  parseDanmakuXml,
  sortDanmakuXmlFiles,
  type DanmakuComment,
} from '@animaku/shared'
import { config } from '../../config'
import { fetchDanmuBoxFile } from './index'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _7z = require('7zip-min') as {
  unpack: (archivePath: string, destPath: string) => Promise<void>
  list: (archivePath: string) => Promise<Array<{ name: string; size?: number }>>
}

// 兼容性保证：确保在 Linux 容器/宿主环境下，7za (p7zip) 子进程能继承 UTF-8 Locale，
// 规避无 LANG 环境变量时 glibc/7za 降级为 POSIX/C 纯 ASCII 编码，导致把中日文文件名替换为 '?'
if (!process.env.LANG) {
  process.env.LANG = 'C.UTF-8'
}
if (!process.env.LC_ALL) {
  process.env.LC_ALL = 'C.UTF-8'
}

const CACHE_BASE_DIR = path.resolve(config.dataDir, 'cache/danmubox')
const ZIPS_DIR = path.resolve(CACHE_BASE_DIR, 'zips')
const UNPACKED_DIR = path.resolve(CACHE_BASE_DIR, 'unpacked')

// In-flight concurrency locks to prevent redundant downloads/extractions
const downloadLocks = new Map<string, Promise<string>>()
const unpackLocks = new Map<string, Promise<string[]>>()

function ensureDirs(): void {
  fs.mkdirSync(ZIPS_DIR, { recursive: true })
  fs.mkdirSync(UNPACKED_DIR, { recursive: true })
}

export function sanitizeFileHash(fileHash: string): string {
  return fileHash.replace(/[/\\]/g, '_').trim()
}

/**
 * Download a .7z archive to disk cache.
 * Uses atomic file writing (*.tmp -> target) and concurrency lock.
 */
export async function ensureArchiveDownloaded(
  repo: string,
  fileHash: string,
): Promise<string> {
  ensureDirs()
  const safeHash = sanitizeFileHash(fileHash)
  const zipPath = path.join(ZIPS_DIR, `${safeHash}.7z`)

  if (fs.existsSync(zipPath)) {
    const stat = fs.statSync(zipPath)
    if (stat.size > 0) return zipPath
  }

  const lockKey = `${repo}:${safeHash}`
  const existingLock = downloadLocks.get(lockKey)
  if (existingLock) return existingLock

  const promise = (async () => {
    try {
      console.log(`[danmubox] 正在下载归档包 ${repo}/${fileHash}.7z ...`)
      const res = await fetchDanmuBoxFile(`${repo}/${fileHash}.7z`)
      if (!res.ok || !res.body) {
        throw new Error(`下载失败 HTTP ${res.status}`)
      }

      const tmpPath = `${zipPath}.${Date.now()}.tmp`
      const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
      const fileStream = fs.createWriteStream(tmpPath)

      await pipeline(nodeStream, fileStream)

      fs.renameSync(tmpPath, zipPath)
      const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)
      console.log(`[danmubox] 归档包已固化至磁盘: ${safeHash}.7z (${sizeMb} MB)`)
      return zipPath
    } finally {
      downloadLocks.delete(lockKey)
    }
  })()

  downloadLocks.set(lockKey, promise)
  return promise
}

function findXmlFilesRecursively(dir: string, baseDir = dir): string[] {
  const result: string[] = []
  if (!fs.existsSync(dir)) return result

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...findXmlFilesRecursively(fullPath, baseDir))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
      const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/')
      result.push(rel)
    }
  }
  return result
}

/**
 * Unpack a .7z archive to disk cache and return all internal XML filenames.
 */
export async function ensureArchiveUnpacked(
  repo: string,
  fileHash: string,
): Promise<string[]> {
  ensureDirs()
  const safeHash = sanitizeFileHash(fileHash)
  const unpackDir = path.join(UNPACKED_DIR, safeHash)

  if (fs.existsSync(unpackDir)) {
    const existingXmls = findXmlFilesRecursively(unpackDir)
    if (existingXmls.length > 0) {
      // 容错与历史坏缓存自愈：
      // 在缺少 UTF-8 语言环境的历史版本中，7za 会把中日文文件名全提取为带有 '?' 的损坏文件。
      // 合法的番剧 XML 路径中绝不可能包含 '?' 字符，若发现即判定为损坏缓存，自动清理并触发重新解压。
      const hasCorruptedNames = existingXmls.some((f) => f.includes('?'))
      if (!hasCorruptedNames) {
        return sortDanmakuXmlFiles(existingXmls)
      }
      console.warn(
        `[danmubox] 检测到归档包 ${safeHash} 包含被 '?' 损坏的解压文件，自动清理并重新解压...`,
      )
      try {
        fs.rmSync(unpackDir, { recursive: true, force: true })
      } catch (err) {
        console.error(`[danmubox] 清理损坏解压缓存失败:`, err)
      }
    }
  }

  const lockKey = `${repo}:${safeHash}`
  const existingLock = unpackLocks.get(lockKey)
  if (existingLock) return existingLock

  const promise = (async () => {
    try {
      const zipPath = await ensureArchiveDownloaded(repo, fileHash)
      fs.mkdirSync(unpackDir, { recursive: true })

      console.log(`[danmubox] 正在解压归档包 ${safeHash}.7z 到 ${unpackDir} ...`)
      await _7z.unpack(zipPath, unpackDir)

      const xmlFiles = sortDanmakuXmlFiles(findXmlFilesRecursively(unpackDir))
      console.log(`[danmubox] 归档包解压完成，包含 ${xmlFiles.length} 个 XML 文件`)
      return xmlFiles
    } finally {
      unpackLocks.delete(lockKey)
    }
  })()

  unpackLocks.set(lockKey, promise)
  return promise
}

export interface DanmuBoxCommentsResult {
  file: string
  allFiles: string[]
  comments: DanmakuComment[]
  count: number
}

/**
 * Extract and parse target episode XML from archive.
 */
export async function getDanmuBoxEpisodeComments(
  repo: string,
  fileHash: string,
  opts?: {
    file?: string
    episode?: number
    seasonTag?: string
  },
): Promise<DanmuBoxCommentsResult> {
  const safeHash = sanitizeFileHash(fileHash)
  const unpackDir = path.join(UNPACKED_DIR, safeHash)
  const xmlFiles = await ensureArchiveUnpacked(repo, fileHash)

  if (!xmlFiles.length) {
    throw new Error(`[danmubox] 归档包 ${safeHash} 内未找到任何 XML 文件`)
  }

  let pickedFile = ''
  if (opts?.file && xmlFiles.includes(opts.file)) {
    pickedFile = opts.file
  } else if (opts?.episode !== undefined) {
    pickedFile =
      matchBestEpisodeXml(xmlFiles, opts.episode, opts.seasonTag) || xmlFiles[0]
  } else {
    pickedFile = xmlFiles[0]
  }

  const targetPath = path.join(unpackDir, pickedFile)
  if (!fs.existsSync(targetPath)) {
    throw new Error(`[danmubox] 目标弹幕文件 ${pickedFile} 不存在`)
  }

  const rawXml = await fs.promises.readFile(targetPath, 'utf8')
  const comments = parseDanmakuXml(rawXml).map((c) => ({
    ...c,
    source: 'danmubox',
  }))

  return {
    file: pickedFile,
    allFiles: xmlFiles,
    comments,
    count: comments.length,
  }
}

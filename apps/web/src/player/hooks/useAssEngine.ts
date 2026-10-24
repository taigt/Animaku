import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubtitleTrack } from '@animaku/shared'
import JASSUB from 'jassub'
import workerUrl from 'jassub/dist/wasm/jassub-worker.js?worker&url'
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url'
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url'

interface UseAssEngineOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  subtitles?: SubtitleTrack[]
  fonts?: string[]
}

/**
 * 智能选取最合适的 ASS 字幕轨：
 * 1. 过滤 format === 'ass' 且有有效 url 的字幕；
 * 2. 匹配 default === true；
 * 3. 匹配包含简中（CHS/SC/简/GB）标识；
 * 4. 备用繁中（CHT/TC/繁/BIG5）或首条 ASS。
 */
export function selectBestAssTrack(subtitles?: SubtitleTrack[]): SubtitleTrack | null {
  if (!subtitles || !subtitles.length) return null
  const assTracks = subtitles.filter((s) => s.format === 'ass' && Boolean(s.url))
  if (!assTracks.length) return null

  // 1. 显式标记 default
  const def = assTracks.find((s) => s.default)
  if (def) return def

  // 2. 简中优先
  const chs = assTracks.find((s) => /chs|sc|简|gb/i.test(s.label || s.id))
  if (chs) return chs

  // 3. 繁中备用
  const cht = assTracks.find((s) => /cht|tc|繁|big5/i.test(s.label || s.id))
  if (cht) return cht

  return assTracks[0] || null
}

export function useAssEngine({
  videoRef,
  subtitles,
  fonts,
}: UseAssEngineOptions) {
  const activeTrack = useMemo(() => selectBestAssTrack(subtitles), [subtitles])
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const jassubRef = useRef<JASSUB | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !canvasEl || !activeTrack?.url) {
      if (jassubRef.current) {
        try {
          void jassubRef.current.destroy()
        } catch {
          /* ignore */
        }
        jassubRef.current = null
      }
      return
    }

    let disposed = false
    let instance: JASSUB | null = null

    /*
     * 特殊处理说明：
     * 1. Canvas 预先对齐视频物理分辨率，防止 transferControlToOffscreen 后默认为 300x150 导致画面模糊拉伸；
     * 2. 传入通过 Vite ?worker&url / ?url 显式引用的 Worker 与 WASM 路径，彻底杜绝运行时相对路径探测断裂；
     * 3. 仅在 JASSUB 真正 ready 成功后才关闭原生软字幕轨，避免双层重叠；若发生异常则保持原生轨道。
     */
    const vWidth = video.videoWidth || 1920
    const vHeight = video.videoHeight || 1080
    canvasEl.width = vWidth
    canvasEl.height = vHeight

    try {
      instance = new JASSUB({
        video,
        canvas: canvasEl,
        subUrl: activeTrack.url,
        fonts: fonts && fonts.length > 0 ? fonts : undefined,
        workerUrl,
        wasmUrl,
        modernWasmUrl,
        prescaleFactor: 1.0,
        prescaleHeightLimit: 1080,
        maxRenderHeight: 0,
      })
      jassubRef.current = instance

      instance.ready
        .then(() => {
          if (disposed) return
          // JASSUB 成功挂载后，静默禁用原生 video.textTracks，防止两层字幕重叠
          try {
            for (let i = 0; i < video.textTracks.length; i++) {
              video.textTracks[i].mode = 'disabled'
            }
          } catch {
            /* ignore */
          }
        })
        .catch((err) => {
          console.warn('[JASSUB] ready failed:', err)
        })
    } catch (err) {
      console.warn('[JASSUB] constructor error:', err)
    }

    return () => {
      disposed = true
      if (instance) {
        try {
          void instance.destroy()
        } catch {
          /* ignore */
        }
      }
      if (jassubRef.current === instance) {
        jassubRef.current = null
      }
    }
  }, [videoRef, canvasEl, activeTrack?.url, fonts])

  return {
    activeTrack,
    setCanvasEl,
  }
}

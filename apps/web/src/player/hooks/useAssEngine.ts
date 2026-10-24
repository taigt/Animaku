import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubtitleTrack } from '@animaku/shared'

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
  const jassubRef = useRef<any>(null)

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
    let instance: any = null

    // 当 ASS 激活时，隐藏原生 video.textTracks，防止两层字幕冲突重叠
    const suppressNativeTracks = () => {
      try {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled'
        }
      } catch {
        /* ignore */
      }
    }
    suppressNativeTracks()
    video.textTracks.addEventListener?.('change', suppressNativeTracks)

    // 动态懒加载 JASSUB，避免在无 ASS 字幕时增加首屏包大小
    void import('jassub')
      .then(({ default: JASSUB }) => {
        if (disposed) return

        /*
         * 特殊处理说明：
         * HTMLCanvasElement 在调用 transferControlToOffscreen 后被锁定所有权，
         * 无法被二次绑定或获取 2D 上下文。外部必须使用 key={activeTrack.url}
         * 保证每次换集或换轨重新实例化时，Canvas 均为新创建的纯净 DOM 节点。
         */
        instance = new JASSUB({
          video,
          canvas: canvasEl,
          subUrl: activeTrack.url,
          fonts: fonts && fonts.length > 0 ? fonts : undefined,
          prescaleFactor: 1.0,
          prescaleHeightLimit: 1080,
          maxRenderHeight: 0,
        })
        jassubRef.current = instance
      })
      .catch((err) => {
        console.warn('[JASSUB] 初始化失败，回退原生字幕渲染:', err)
      })

    return () => {
      disposed = true
      video.textTracks.removeEventListener?.('change', suppressNativeTracks)
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

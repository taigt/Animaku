import { useCallback, useMemo } from 'react'
import clsx from 'clsx'
import type { PluginMeta } from '@animaku/shared'
import { comparePluginOrder } from '@animaku/shared'
import { usePluginStore } from '../../stores/plugins'
import {
  IconChevronLeft,
  IconChevronUp,
  IconChevronDown,
  IconReset,
} from './icons'

export interface SourcePreferenceMenuProps {
  onBack?: () => void
  title?: string
  onFlashHint?: (msg: string, ms?: number) => void
  isMobile?: boolean
}

/** Sort plugins by user-defined order, falling back to built-in weight order. */
function sortPluginsByOrder(
  plugins: PluginMeta[],
  order: string[],
): PluginMeta[] {
  if (!order.length) {
    return [...plugins].sort(comparePluginOrder)
  }
  const rank = new Map<string, number>()
  for (let i = 0; i < order.length; i++) {
    rank.set(order[i].toLowerCase(), i)
  }
  return [...plugins].sort((a, b) => {
    const ra = rank.get(a.name.toLowerCase()) ?? order.length
    const rb = rank.get(b.name.toLowerCase()) ?? order.length
    if (ra !== rb) return ra - rb
    return comparePluginOrder(a, b)
  })
}

export function SourcePreferenceMenu({
  onBack,
  title = '视频源偏好',
  onFlashHint,
  isMobile = false,
}: SourcePreferenceMenuProps) {
  const plugins = usePluginStore((s) => (Array.isArray(s.plugins) ? s.plugins : []))
  const pluginOrder = usePluginStore((s) => (Array.isArray(s.pluginOrder) ? s.pluginOrder : []))
  const setPluginOrder = usePluginStore((s) => s.setPluginOrder)
  const togglePlugin = usePluginStore((s) => s.togglePlugin)
  const resetToDefaults = usePluginStore((s) => s.resetToDefaults)

  const sortedPlugins = useMemo(
    () => sortPluginsByOrder(plugins, pluginOrder),
    [plugins, pluginOrder],
  )

  const enabledCount = useMemo(
    () => sortedPlugins.filter((p) => p.enabled !== false).length,
    [sortedPlugins],
  )

  const movePlugin = useCallback(
    (name: string, dir: -1 | 1) => {
      const names = sortedPlugins.map((p) => p.name)
      const idx = names.findIndex(
        (n) => n.toLowerCase() === name.toLowerCase(),
      )
      if (idx < 0) return
      const target = idx + dir
      if (target < 0 || target >= names.length) return

      const nextNames = [...names]
      ;[nextNames[idx], nextNames[target]] = [nextNames[target], nextNames[idx]]
      setPluginOrder(nextNames)

      if (target === 0) {
        onFlashHint?.(`已将「${name}」设为默认首选源`, 1600)
      }
    },
    [sortedPlugins, setPluginOrder, onFlashHint],
  )

  const handleToggle = useCallback(
    (plugin: PluginMeta) => {
      const next = plugin.enabled === false ? true : false
      togglePlugin(plugin.id, next)
      onFlashHint?.(
        next ? `已开启「${plugin.name}」` : `已关闭「${plugin.name}」`,
        1200,
      )
    },
    [togglePlugin, onFlashHint],
  )

  const handleReset = useCallback(() => {
    resetToDefaults()
    onFlashHint?.('已恢复官方默认推荐配置', 1600)
  }, [resetToDefaults, onFlashHint])

  return (
    <div className="kz-source-pref-menu flex flex-col w-full max-h-[min(18rem,65vh)] select-none">
      {/* Header Bar */}
      <div className="kz-settings-header flex items-center justify-between pb-1.5 mb-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {onBack && (
            <button
              type="button"
              className="kz-settings-back-btn p-1 rounded cursor-pointer transition-colors"
              onClick={onBack}
              title="返回设置"
              aria-label="返回设置"
            >
              <IconChevronLeft />
            </button>
          )}
          <span className="kz-source-pref-title truncate">
            {title}
          </span>
        </div>
        <span className="kz-source-pref-count font-normal flex-shrink-0">
          {enabledCount}/{sortedPlugins.length} 启用
        </span>
      </div>

      {/* Scrollable Source List with strict height and overflow control */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5 space-y-1 [scrollbar-width:thin]">
        {sortedPlugins.length === 0 ? (
          <div className="py-4 text-center text-xs opacity-60">
            暂无可用视频源规则
          </div>
        ) : (
          sortedPlugins.map((plugin, index) => {
            const isFirst = index === 0
            const isLast = index === sortedPlugins.length - 1
            const isEnabled = plugin.enabled !== false

            return (
              <div
                key={plugin.id || plugin.name}
                className="kz-source-pref-item"
                data-default={isFirst && isEnabled ? 'true' : undefined}
                data-disabled={!isEnabled ? 'true' : undefined}
              >
                {/* Source Info (Index, Name, First Badge) */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                  <span className="kz-source-pref-rank flex-shrink-0 w-3.5 text-center">
                    {index + 1}
                  </span>
                  <span
                    className="kz-source-pref-name truncate"
                    title={plugin.name}
                  >
                    {plugin.name}
                  </span>
                  {isFirst && isEnabled && (
                    <span className="kz-source-pref-badge flex-shrink-0">
                      首选
                    </span>
                  )}
                </div>

                {/* Priority Adjust & Enable Switch */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => movePlugin(plugin.name, -1)}
                    className="kz-source-pref-btn cursor-pointer transition-colors"
                    title={isFirst ? '已是首选源' : '提高优先级'}
                    aria-label={`提高 ${plugin.name} 优先级`}
                  >
                    <IconChevronUp className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => movePlugin(plugin.name, 1)}
                    className="kz-source-pref-btn cursor-pointer transition-colors"
                    title={isLast ? '已是末位' : '降低优先级'}
                    aria-label={`降低 ${plugin.name} 优先级`}
                  >
                    <IconChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {/* Enable Switch Toggle */}
                  <div
                    className={clsx(
                      'kz-switch cursor-pointer ml-1',
                      isMobile && 'kz-switch--mobile',
                    )}
                    data-checked={isEnabled}
                    onClick={() => handleToggle(plugin)}
                    title={isEnabled ? `点击禁用 ${plugin.name}` : `点击启用 ${plugin.name}`}
                    role="switch"
                    aria-checked={isEnabled}
                    aria-label={`启用 ${plugin.name}`}
                  >
                    <div className="kz-switch-thumb" />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer Actions (Reset to defaults) */}
      <div className="kz-source-pref-footer flex items-center justify-between flex-shrink-0 px-0.5">
        <button
          type="button"
          onClick={handleReset}
          className="kz-source-pref-reset cursor-pointer"
          title="重置为官方推荐的初始源排序与开启状态"
        >
          <IconReset className="w-3 h-3" />
          <span>恢复默认推荐</span>
        </button>

        <span className="kz-source-pref-hint">
          顺位第1项为首选源
        </span>
      </div>
    </div>
  )
}

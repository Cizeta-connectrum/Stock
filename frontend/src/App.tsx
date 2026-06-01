import { useState } from 'react'
import StrategyBuilder from './components/StrategyBuilder'
import ResultsDashboard from './components/ResultsDashboard'
import DataManager from './components/DataManager'
import Optimizer from './components/Optimizer'
import type { BacktestResult, StrategyConfig } from './lib/api'
import { runBacktest } from './lib/api'

type Tab = 'backtest' | 'optimize' | 'data'

const TAB_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'backtest',  label: 'バックテスト', icon: '▶' },
  { id: 'optimize',  label: '最適化',       icon: '⚙' },
  { id: 'data',      label: 'データ',       icon: '↓' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('backtest')
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preloadConfig, setPreloadConfig] = useState<StrategyConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(true)

  function handleApplyOptimize(config: StrategyConfig) {
    setPreloadConfig(config)
    setTab('backtest')
    setSettingsOpen(true)
  }

  async function handleRun(config: StrategyConfig) {
    setLoading(true)
    setError(null)
    setSettingsOpen(false)
    try {
      const res = await runBacktest(config)
      setResult(res)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail || (e as { message?: string })?.message || 'エラーが発生しました'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 pb-16 lg:pb-0">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-2.5 sticky top-0 z-20">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-xl text-amber-400">▲</div>
            <div>
              <h1 className="text-base font-bold text-amber-400 leading-tight">Gold Backtest</h1>
              <p className="text-xs text-gray-500 hidden sm:block">ゴールド先物バックテスト</p>
            </div>
          </div>
          {/* Desktop tabs */}
          <nav className="hidden lg:flex gap-1">
            {TAB_ITEMS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-gray-800 border-t border-gray-700 flex">
        {TAB_ITEMS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs font-medium transition-colors ${
              tab === t.id ? 'text-amber-400' : 'text-gray-500'
            }`}>
            <span className="text-base leading-none">{t.icon}</span>
            <span>{t.label}</span>
            {tab === t.id && <span className="absolute bottom-0 h-0.5 w-8 bg-amber-400 rounded-t" />}
          </button>
        ))}
      </nav>

      <div className="max-w-screen-xl mx-auto p-3 md:p-6">
        {tab === 'data' ? (
          <DataManager />
        ) : tab === 'optimize' ? (
          <Optimizer onApply={handleApplyOptimize} />
        ) : (
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Settings panel */}
            <aside className="lg:w-96 flex-shrink-0">
              <div className="bg-gray-800 rounded-xl lg:sticky lg:top-20">
                {/* Mobile toggle header */}
                <button
                  className="lg:hidden w-full flex items-center justify-between px-5 py-3"
                  onClick={() => setSettingsOpen(o => !o)}
                >
                  <span className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                    戦略設定
                  </span>
                  <span className="text-gray-400 text-lg">{settingsOpen ? '▲' : '▼'}</span>
                </button>
                {/* Desktop header */}
                <div className="hidden lg:flex items-center gap-2 px-5 pt-5 pb-4">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  <h2 className="text-sm font-semibold text-gray-200">戦略設定</h2>
                </div>
                <div className={`px-5 pb-5 ${settingsOpen ? 'block' : 'hidden lg:block'}`}>
                  <StrategyBuilder onRun={handleRun} loading={loading} preloadConfig={preloadConfig} />
                </div>
              </div>
            </aside>

            <main className="flex-1 min-w-0">
              {error && (
                <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 mb-4 text-red-300 text-sm">
                  {error}
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center h-48">
                  <div className="text-center space-y-3">
                    <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-gray-400 text-sm">バックテスト実行中...</p>
                  </div>
                </div>
              )}
              {!loading && !result && !error && (
                <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
                  <div className="text-4xl text-amber-500/30">▲</div>
                  <p className="text-gray-400 text-sm">戦略を設定してバックテストを実行してください</p>
                  <p className="text-xs text-gray-500">分足データは「データ」タブで先にダウンロード</p>
                </div>
              )}
              {!loading && result && <ResultsDashboard result={result} />}
            </main>
          </div>
        )}
      </div>
    </div>
  )
}

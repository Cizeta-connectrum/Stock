import { useState } from 'react'
import StrategyBuilder from './components/StrategyBuilder'
import ResultsDashboard from './components/ResultsDashboard'
import DataManager from './components/DataManager'
import type { BacktestResult, StrategyConfig } from './lib/api'
import { runBacktest } from './lib/api'

type Tab = 'backtest' | 'data'

export default function App() {
  const [tab, setTab] = useState<Tab>('backtest')
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRun(config: StrategyConfig) {
    setLoading(true)
    setError(null)
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
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl text-amber-400">&#9651;</div>
            <div>
              <h1 className="text-lg font-bold text-amber-400">Gold Backtest Platform</h1>
              <p className="text-xs text-gray-400">ゴールド先物バックテスト</p>
            </div>
          </div>
          {/* Tabs */}
          <nav className="flex gap-1">
            <button
              onClick={() => setTab('backtest')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'backtest'
                  ? 'bg-amber-500 text-black'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              バックテスト
            </button>
            <button
              onClick={() => setTab('data')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'data'
                  ? 'bg-amber-500 text-black'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              データ管理
            </button>
          </nav>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto p-4 md:p-6">
        {tab === 'data' ? (
          <DataManager />
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            <aside className="lg:w-96 flex-shrink-0">
              <div className="bg-gray-800 rounded-xl p-5 sticky top-6">
                <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
                  戦略設定
                </h2>
                <StrategyBuilder onRun={handleRun} loading={loading} />
              </div>
            </aside>

            <main className="flex-1 min-w-0">
              {error && (
                <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 mb-4 text-red-300 text-sm">
                  {error}
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-3">
                    <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-gray-400 text-sm">バックテスト実行中...</p>
                  </div>
                </div>
              )}
              {!loading && !result && !error && (
                <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
                  <div className="text-5xl text-amber-500/30">&#9651;</div>
                  <p className="text-gray-400">左の戦略設定を行い、バックテストを実行してください</p>
                  <p className="text-xs text-gray-500">
                    分足データを使う場合は先に「データ管理」タブでダウンロードしてください
                  </p>
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

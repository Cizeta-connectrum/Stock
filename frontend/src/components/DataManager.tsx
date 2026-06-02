import { useState, useEffect } from 'react'
import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface DataStatus {
  symbol: string
  interval: string
  bars: number
  first_date: string
  last_date: string
}

const INTRADAY_INTERVALS = [
  { value: '1m',  label: '1分足',   yf_days: 29 },
  { value: '5m',  label: '5分足',   yf_days: 59 },
  { value: '15m', label: '15分足',  yf_days: 59 },
  { value: '30m', label: '30分足',  yf_days: 59 },
  { value: '1h',  label: '1時間足', yf_days: 729 },
  { value: '1d',  label: '日足',    yf_days: 3650 },
]

export default function DataManager() {
  const [status, setStatus] = useState<DataStatus[]>([])

  // yfinance state
  const [yfInterval, setYfInterval] = useState('5m')
  const [yfDays, setYfDays] = useState<number | ''>('')
  const [yfLoading, setYfLoading] = useState(false)
  const [yfResult, setYfResult] = useState<string | null>(null)

  // Twelve Data state
  const [tdKey, setTdKey] = useState(() => localStorage.getItem('td_api_key') || '')
  const [tdInterval, setTdInterval] = useState('5m')
  const [tdStart, setTdStart] = useState('2020-01-01')
  const [tdEnd, setTdEnd] = useState('')
  const [tdLoading, setTdLoading] = useState(false)
  const [tdResult, setTdResult] = useState<string | null>(null)

  async function loadStatus() {
    try {
      const res = await axios.get(`${BASE}/api/data/status`)
      setStatus(res.data.datasets)
    } catch {
      setStatus([])
    }
  }

  useEffect(() => { loadStatus() }, [])

  async function handleYfDownload() {
    setYfLoading(true)
    setYfResult(null)
    try {
      const body: Record<string, unknown> = { interval: yfInterval }
      if (yfDays !== '') body.days_back = Number(yfDays)
      const res = await axios.post(`${BASE}/api/data/download/yfinance`, body)
      const d = res.data
      setYfResult(`完了: ${d.bars_stored.toLocaleString()}本保存 (${d.interval}, ${d.days_requested}日分)${d.errors?.length ? `\n警告: ${d.errors[0]}` : ''}`)
      loadStatus()
    } catch (e: unknown) {
      setYfResult(`エラー: ${(e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '失敗'}`)
    } finally {
      setYfLoading(false)
    }
  }

  async function handleTdDownload() {
    if (!tdKey.trim()) { setTdResult('エラー: APIキーを入力してください'); return }
    setTdLoading(true)
    setTdResult(null)
    try {
      const body: Record<string, unknown> = {
        api_key: tdKey.trim(),
        interval: tdInterval,
        start_date: tdStart,
      }
      if (tdEnd) body.end_date = tdEnd
      const res = await axios.post(`${BASE}/api/data/download/twelvedata`, body, { timeout: 3600000 })
      const d = res.data
      setTdResult(
        `完了: ${d.bars_stored.toLocaleString()}本保存\n` +
        `期間: ${d.start_date} 〜 ${d.end_date}\n` +
        `リクエスト数: ${d.requests_made}回` +
        (d.errors?.length ? `\n警告: ${d.errors[0]}` : '')
      )
      loadStatus()
    } catch (e: unknown) {
      setTdResult(`エラー: ${(e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '失敗'}`)
    } finally {
      setTdLoading(false)
    }
  }

  const selectedYf = INTRADAY_INTERVALS.find(i => i.value === yfInterval)

  // Estimate download time for Twelve Data
  const barsPerReq = 5000
  const barsPerDay: Record<string, number> = { '1m': 390, '5m': 78, '15m': 26, '30m': 13, '1h': 7, '1d': 1 }
  const dayCount = tdStart ? Math.ceil((Date.now() - new Date(tdStart).getTime()) / 86400000 * 5 / 7) : 0
  const estimatedReqs = Math.ceil((dayCount * (barsPerDay[tdInterval] || 78)) / barsPerReq)
  const estimatedMins = Math.ceil(estimatedReqs * 8 / 60)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">

      {/* Stored data status */}
      <div className="bg-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-200">保存済みデータ</h3>
          <button onClick={loadStatus} className="text-xs text-gray-400 hover:text-amber-400 border border-gray-600 rounded px-2 py-1">更新</button>
        </div>
        {status.length === 0 ? (
          <p className="text-gray-500 text-sm">データなし。下のフォームでダウンロードしてください。</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-700 text-left">
                <th className="pb-2 pr-4">シンボル</th>
                <th className="pb-2 pr-4">足種</th>
                <th className="pb-2 pr-4 text-right">本数</th>
                <th className="pb-2 pr-4">開始日</th>
                <th className="pb-2">終了日</th>
              </tr>
            </thead>
            <tbody>
              {status.map((s, i) => (
                <tr key={i} className="border-b border-gray-700/40">
                  <td className="py-1.5 pr-4 text-amber-400">{s.symbol}</td>
                  <td className="py-1.5 pr-4">{s.interval}</td>
                  <td className="py-1.5 pr-4 text-right text-green-400">{s.bars.toLocaleString()}</td>
                  <td className="py-1.5 pr-4 text-gray-400">{s.first_date}</td>
                  <td className="py-1.5 text-gray-400">{s.last_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Twelve Data */}
      <div className="bg-gray-800 rounded-xl p-5 border border-amber-500/30">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-gray-200">Twelve Data（推奨・無料）</h3>
          <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">無料APIキーで数年分取得可</span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          無料枠: 800リクエスト/日 × 5000本 = 最大400万本/日取得可能。<br />
          APIキー取得（1分）: <span className="text-blue-400">https://twelvedata.com</span> → 「Get free API key」
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">APIキー</label>
            <div className="flex gap-2 items-center">
              <input
                type="text" value={tdKey}
                onChange={e => setTdKey(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm w-full max-w-sm font-mono"
              />
              <button
                onClick={() => { localStorage.setItem('td_api_key', tdKey); alert('APIキーを保存しました') }}
                className="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:border-amber-500 whitespace-nowrap"
              >
                保存
              </button>
              {localStorage.getItem('td_api_key') && (
                <button
                  onClick={() => { localStorage.removeItem('td_api_key'); setTdKey('') }}
                  className="text-xs px-2 py-1.5 rounded border border-red-800 text-red-400 hover:border-red-500 whitespace-nowrap"
                >
                  削除
                </button>
              )}
            </div>
            {localStorage.getItem('td_api_key') && (
              <p className="text-xs text-green-500 mt-1">✓ APIキーが保存されています</p>
            )}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">足種</label>
              <select value={tdInterval} onChange={e => setTdInterval(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
                {INTRADAY_INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">開始日</label>
              <input type="date" value={tdStart} onChange={e => setTdStart(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">終了日（空=今日）</label>
              <input type="date" value={tdEnd} onChange={e => setTdEnd(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm" />
            </div>
          </div>
          {tdStart && (
            <p className="text-xs text-gray-500">
              推定: 約{estimatedReqs.toLocaleString()}リクエスト・所要時間 約{estimatedMins}分
              {estimatedReqs > 800 ? (
                <span className="text-yellow-400 ml-2">⚠ 無料枠(800回/日)を超えます。複数日に分けてください</span>
              ) : null}
            </p>
          )}
          <button
            onClick={handleTdDownload}
            disabled={tdLoading}
            className="px-5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {tdLoading && <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>}
            {tdLoading ? 'ダウンロード中（バックグラウンドで実行中）...' : 'ダウンロード開始'}
          </button>
          {tdLoading && (
            <p className="text-xs text-gray-400">8秒/リクエストのペースで取得中です。このページは閉じないでください。</p>
          )}
          {tdResult && (
            <div className={`text-sm rounded px-3 py-2 whitespace-pre-wrap ${
              tdResult.startsWith('エラー') ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'
            }`}>{tdResult}</div>
          )}
        </div>
      </div>

      {/* yfinance */}
      <div className="bg-gray-800 rounded-xl p-5">
        <h3 className="font-semibold text-gray-200 mb-1">yfinance（APIキー不要・短期間のみ）</h3>
        <p className="text-xs text-gray-500 mb-4">
          1m=最大29日 / 5m・15m・30m=最大59日 / 1h=最大729日
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">足種</label>
            <select value={yfInterval} onChange={e => setYfInterval(e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
              {INTRADAY_INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">取得日数（空=最大{selectedYf?.yf_days}日）</label>
            <input
              type="number" value={yfDays}
              onChange={e => setYfDays(e.target.value === '' ? '' : Number(e.target.value))}
              min={1} max={selectedYf?.yf_days}
              placeholder={`最大${selectedYf?.yf_days}日`}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm w-36"
            />
          </div>
          <button
            onClick={handleYfDownload}
            disabled={yfLoading}
            className="px-4 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-white font-medium text-sm disabled:opacity-50"
          >
            {yfLoading ? 'ダウンロード中...' : 'ダウンロード'}
          </button>
        </div>
        {yfResult && (
          <div className={`mt-3 text-sm rounded px-3 py-2 whitespace-pre-wrap ${
            yfResult.startsWith('エラー') ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'
          }`}>{yfResult}</div>
        )}
      </div>
    </div>
  )
}

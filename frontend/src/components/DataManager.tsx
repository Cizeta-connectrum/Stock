import { useState, useEffect } from 'react'
import axios from 'axios'

const BASE = 'http://localhost:8000'

interface DataStatus {
  symbol: string
  interval: string
  bars: number
  first_date: string
  last_date: string
}

const INTRADAY_INTERVALS = [
  { value: '1m',  label: '1分足',   yf_days: 29,  note: 'yfinance: 最大29日' },
  { value: '5m',  label: '5分足',   yf_days: 59,  note: 'yfinance: 最大59日' },
  { value: '15m', label: '15分足',  yf_days: 59,  note: 'yfinance: 最大59日' },
  { value: '30m', label: '30分足',  yf_days: 59,  note: 'yfinance: 最大59日' },
  { value: '1h',  label: '1時間足', yf_days: 729, note: 'yfinance: 最大729日' },
  { value: '1d',  label: '日足',    yf_days: 3650, note: 'yfinance: 無制限' },
]

const AV_INTERVALS = [
  { value: '1m',  label: '1分足' },
  { value: '5m',  label: '5分足' },
  { value: '15m', label: '15分足' },
  { value: '30m', label: '30分足' },
  { value: '1h',  label: '1時間足' },
]

export default function DataManager() {
  const [status, setStatus] = useState<DataStatus[]>([])
  const [yfInterval, setYfInterval] = useState('5m')
  const [yfDays, setYfDays] = useState<number | ''>('')
  const [yfLoading, setYfLoading] = useState(false)
  const [yfResult, setYfResult] = useState<string | null>(null)

  const [avKey, setAvKey] = useState('')
  const [avInterval, setAvInterval] = useState('5m')
  const [avMonths, setAvMonths] = useState(24)
  const [avLoading, setAvLoading] = useState(false)
  const [avResult, setAvResult] = useState<string | null>(null)

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
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '失敗'
      setYfResult(`エラー: ${msg}`)
    } finally {
      setYfLoading(false)
    }
  }

  async function handleAvDownload() {
    if (!avKey) { setAvResult('エラー: APIキーを入力してください'); return }
    setAvLoading(true)
    setAvResult(null)
    try {
      const res = await axios.post(`${BASE}/api/data/download/alphavantage`, {
        api_key: avKey,
        interval: avInterval,
        months_back: avMonths,
      })
      const d = res.data
      setAvResult(`完了: ${d.bars_stored.toLocaleString()}本保存 (${d.interval}, ${d.months_requested}ヶ月分)${d.errors?.length ? `\n警告: ${d.errors[0]}` : ''}`)
      loadStatus()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '失敗'
      setAvResult(`エラー: ${msg}`)
    } finally {
      setAvLoading(false)
    }
  }

  const selectedYfInterval = INTRADAY_INTERVALS.find(i => i.value === yfInterval)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Stored data status */}
      <div className="bg-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-200">保存済みデータ</h3>
          <button onClick={loadStatus} className="text-xs text-gray-400 hover:text-amber-400 border border-gray-600 rounded px-2 py-1">
            更新
          </button>
        </div>
        {status.length === 0 ? (
          <p className="text-gray-500 text-sm">データなし。下のフォームでダウンロードしてください。</p>
        ) : (
          <div className="overflow-x-auto">
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
          </div>
        )}
      </div>

      {/* yfinance download */}
      <div className="bg-gray-800 rounded-xl p-5">
        <h3 className="font-semibold text-gray-200 mb-1">yfinance ダウンロード（無料・APIキー不要）</h3>
        <p className="text-xs text-gray-500 mb-4">
          Yahoo Financeからゴールドデータを取得してローカルに保存します。<br />
          制限: 1m=最大29日、5m/15m/30m=最大59日、1h=最大729日
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">足種</label>
            <select value={yfInterval} onChange={e => setYfInterval(e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
              {INTRADAY_INTERVALS.map(i => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              取得日数（空=最大 {selectedYfInterval?.yf_days}日）
            </label>
            <input
              type="number" value={yfDays}
              onChange={e => setYfDays(e.target.value === '' ? '' : Number(e.target.value))}
              min={1} max={selectedYfInterval?.yf_days}
              placeholder={`最大${selectedYfInterval?.yf_days}日`}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm w-36"
            />
          </div>
          <button
            onClick={handleYfDownload}
            disabled={yfLoading}
            className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-medium text-sm disabled:opacity-50"
          >
            {yfLoading ? 'ダウンロード中...' : 'ダウンロード'}
          </button>
        </div>
        {yfResult && (
          <div className={`mt-3 text-sm rounded px-3 py-2 whitespace-pre-wrap ${
            yfResult.startsWith('エラー') ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'
          }`}>
            {yfResult}
          </div>
        )}
      </div>

      {/* Alpha Vantage download */}
      <div className="bg-gray-800 rounded-xl p-5">
        <h3 className="font-semibold text-gray-200 mb-1">Alpha Vantage ダウンロード（無料APIキーで最大数年分）</h3>
        <p className="text-xs text-gray-500 mb-1">
          <span className="text-amber-400">より長期の分足データ</span>が取得できます。無料枠: 25リクエスト/日（= 25ヶ月分/日）
        </p>
        <p className="text-xs text-gray-500 mb-4">
          APIキー取得: <span className="text-blue-400">https://www.alphavantage.co/support/#api-key</span>（無料・メール登録のみ）
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">APIキー</label>
            <input
              type="text" value={avKey} onChange={e => setAvKey(e.target.value)}
              placeholder="YOUR_API_KEY"
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm w-full max-w-xs"
            />
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">足種</label>
              <select value={avInterval} onChange={e => setAvInterval(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm">
                {AV_INTERVALS.map(i => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">取得月数</label>
              <input
                type="number" value={avMonths} onChange={e => setAvMonths(Number(e.target.value))}
                min={1} max={120}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm w-24"
              />
            </div>
            <button
              onClick={handleAvDownload}
              disabled={avLoading}
              className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm disabled:opacity-50"
            >
              {avLoading ? 'ダウンロード中...' : 'ダウンロード'}
            </button>
          </div>
          {avLoading && (
            <p className="text-xs text-gray-400">
              ※ 無料枠は1分5リクエストの制限があるため時間がかかります（約{Math.ceil(avMonths / 5)}分）
            </p>
          )}
          {avResult && (
            <div className={`text-sm rounded px-3 py-2 whitespace-pre-wrap ${
              avResult.startsWith('エラー') ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'
            }`}>
              {avResult}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

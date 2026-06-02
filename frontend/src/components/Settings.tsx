import { useState } from 'react'
import type { TradingSettings } from '../lib/settings'
import { calcMaxLots } from '../lib/settings'

interface Props {
  settings: TradingSettings
  onSave: (s: TradingSettings) => void
}

const LEVERAGE_PRESETS = [25, 50, 100, 200, 500, 1000]

export default function Settings({ settings, onSave }: Props) {
  const [local, setLocal] = useState<TradingSettings>({ ...settings })
  const [saved, setSaved] = useState(false)

  function set(key: keyof TradingSettings, value: number) {
    setLocal(s => ({ ...s, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    onSave(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const maxLots = calcMaxLots(local.initial_capital, local.leverage, 2500, local.usd_jpy)
  const ozPerLot = 100
  const notionalJpy = maxLots * ozPerLot * 2500 * local.usd_jpy
  const effectiveLeverage = local.initial_capital > 0 ? notionalJpy / local.initial_capital : 0

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="bg-gray-800 rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          取引設定
        </h2>

        {/* USD/JPY */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">為替レート (USD/JPY)</label>
          <div className="flex items-center gap-3">
            <input
              type="number" min="50" max="300" step="0.1"
              value={local.usd_jpy}
              onChange={e => set('usd_jpy', Number(e.target.value))}
              className="bg-gray-700 text-white rounded px-3 py-2 text-sm w-32"
            />
            <span className="text-xs text-gray-500">現在設定: 1 USD = ¥{local.usd_jpy}</span>
          </div>
        </div>

        {/* Initial capital */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">初期証拠金 (¥)</label>
          <div className="flex items-center gap-3">
            <input
              type="number" min="10000" step="10000"
              value={local.initial_capital}
              onChange={e => set('initial_capital', Number(e.target.value))}
              className="bg-gray-700 text-white rounded px-3 py-2 text-sm w-40"
            />
            <span className="text-xs text-gray-500">
              {new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(local.initial_capital)}
            </span>
          </div>
        </div>

        {/* Leverage */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">レバレッジ</label>
          <div className="flex items-center gap-2 flex-wrap">
            {LEVERAGE_PRESETS.map(lv => (
              <button key={lv} onClick={() => set('leverage', lv)}
                className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                  local.leverage === lv
                    ? 'bg-amber-500 border-amber-500 text-black font-semibold'
                    : 'border-gray-600 text-gray-300 hover:border-amber-500'
                }`}>
                {lv}倍
              </button>
            ))}
            <input
              type="number" min="1" max="2000" step="1"
              value={local.leverage}
              onChange={e => set('leverage', Number(e.target.value))}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm w-24"
              placeholder="カスタム"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">現在: {local.leverage}倍レバレッジ</p>
        </div>

        {/* SL / TP */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">損切り (%)</label>
            <input
              type="number" min="0" step="0.1"
              value={local.stop_loss_pct}
              onChange={e => set('stop_loss_pct', Number(e.target.value))}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
              placeholder="0 = 無効"
            />
            <p className="text-xs text-gray-500 mt-0.5">0 で無効</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">利確 (%)</label>
            <input
              type="number" min="0" step="0.1"
              value={local.take_profit_pct}
              onChange={e => set('take_profit_pct', Number(e.target.value))}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
              placeholder="0 = 無効"
            />
            <p className="text-xs text-gray-500 mt-0.5">0 で無効</p>
          </div>
        </div>

        {/* Commission */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">スプレッド / 手数料 (%)</label>
          <div className="flex items-center gap-3">
            <input
              type="number" min="0" step="0.001"
              value={local.commission_pct}
              onChange={e => set('commission_pct', Number(e.target.value))}
              className="bg-gray-700 text-white rounded px-3 py-2 text-sm w-32"
            />
            <span className="text-xs text-gray-500">片道。0.03% = 3銭スプレッド相当</span>
          </div>
        </div>

        <button
          onClick={handleSave}
          className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-colors ${
            saved
              ? 'bg-green-600 text-white'
              : 'bg-amber-500 hover:bg-amber-400 text-black'
          }`}
        >
          {saved ? '✓ 保存しました' : '設定を保存'}
        </button>
      </div>

      {/* Lot calculator */}
      <div className="bg-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-200">ロット計算（{local.leverage}倍レバレッジ）</h3>
        <div className="text-xs text-gray-400 space-y-1">
          <p>必要証拠金: <span className="text-amber-400">1lot あたり ¥{Math.round(100 * 2500 * local.usd_jpy / local.leverage).toLocaleString('ja-JP')}</span>（$2,500/oz 基準）</p>
          <p>1ロット = 100oz (金標準ロット)</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">最大ロット数</div>
            <div className="text-xl font-bold text-amber-400">{maxLots.toFixed(2)} lot</div>
            <div className="text-xs text-gray-500">{(maxLots * 100).toFixed(0)} oz</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">実効レバレッジ</div>
            <div className="text-xl font-bold text-blue-400">{effectiveLeverage.toFixed(1)}倍</div>
            <div className="text-xs text-gray-500">@$2,500/oz 基準</div>
          </div>
        </div>
        <div className="text-xs text-gray-500 bg-gray-700/30 rounded p-2">
          ポジション想定規模: ¥{Math.round(notionalJpy).toLocaleString('ja-JP')}
          （$2,500/oz × {(maxLots * 100).toFixed(0)}oz × ¥{local.usd_jpy}）
        </div>
        <p className="text-xs text-gray-600">
          ※ 損益はすべて円建て。価格データはUSD建て金価格を使用し、決済時に円換算します。
        </p>
      </div>
    </div>
  )
}

import holdings from '../data/qdii-holdings.json'

interface BenchmarkData {
  symbol: string
  name: string
  price: number
  changePercent: number
  updatedAt: number
}

interface ExchangeRate {
  USDCNY: number
  HKDCNY: number
  USDCNYPrice: number
  HKDCNYPrice: number
  updatedAt: number
}

interface EstimateResult {
  code: string
  name: string
  benchmark: string
  benchmarkName: string
  estimatedChange: number  // 预估涨跌幅 %
  benchmarkChange: number  // 基准指数涨跌幅 %
  rateChange: number       // 汇率变动 %
  updatedAt: number
  isMarketOpen: boolean
}

// 内存缓存
let benchmarkCache: Record<string, BenchmarkData> = {}
let rateCache: ExchangeRate | null = null
let lastFetchTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5分钟

// 判断美股是否在交易时段（北京时间）
export function isUSMarketOpen(): boolean {
  const now = new Date()
  const bjHour = (now.getUTCHours() + 8) % 24
  const bjMinute = now.getUTCMinutes()
  const bjTime = bjHour * 60 + bjMinute
  const day = now.getUTCDay() // 0=周日, 6=周六（UTC，北京时间+8后需修正）

  // 北京时间周六/周日美股休市
  const bjDay = ((now.getUTCDay() + (now.getUTCHours() + 8 >= 24 ? 1 : 0)) % 7)
  if (bjDay === 0 || bjDay === 6) return false

  // 美股正式交易：北京时间 21:30 - 次日 04:00
  // 盘前：18:00 - 21:30
  const preMarketStart = 18 * 60      // 18:00
  const marketClose = 4 * 60          // 04:00（次日）

  return bjTime >= preMarketStart || bjTime < marketClose
}

// 从 Yahoo Finance 拉取指数数据
async function fetchBenchmark(symbol: string): Promise<BenchmarkData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null

    const json = await res.json() as any
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) return null

    const price = meta.regularMarketPrice ?? 0
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price
    const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

    const benchmarkInfo = Object.values(holdings.benchmarks).find(
      (b: any) => b.symbol === symbol
    ) as any

    return {
      symbol,
      name: benchmarkInfo?.name ?? symbol,
      price,
      changePercent,
      updatedAt: Date.now()
    }
  } catch (e) {
    console.error(`[QDII] 拉取 ${symbol} 失败:`, e)
    return null
  }
}

// 拉取汇率
async function fetchExchangeRates(): Promise<ExchangeRate | null> {
  try {
    const [usdRes, hkdRes] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDCNY=X?interval=1d&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      }),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/HKDCNY=X?interval=1d&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      })
    ])

    const [usdJson, hkdJson] = await Promise.all([usdRes.json(), hkdRes.json()]) as any[]

    const usdMeta = usdJson?.chart?.result?.[0]?.meta
    const hkdMeta = hkdJson?.chart?.result?.[0]?.meta

    const usdPrice = usdMeta?.regularMarketPrice ?? 7.25
    const usdPrev = usdMeta?.chartPreviousClose ?? usdPrice
    const hkdPrice = hkdMeta?.regularMarketPrice ?? 0.93
    const hkdPrev = hkdMeta?.chartPreviousClose ?? hkdPrice

    return {
      USDCNY: usdPrice > 0 ? ((usdPrice - usdPrev) / usdPrev) * 100 : 0,
      HKDCNY: hkdPrice > 0 ? ((hkdPrice - hkdPrev) / hkdPrev) * 100 : 0,
      USDCNYPrice: usdPrice,
      HKDCNYPrice: hkdPrice,
      updatedAt: Date.now()
    }
  } catch (e) {
    console.error('[QDII] 拉取汇率失败:', e)
    return null
  }
}

// 刷新所有缓存
async function refreshCache() {
  const symbols = [...new Set(
    Object.values(holdings.benchmarks).map((b: any) => b.symbol)
  )]

  const [benchmarkResults, rates] = await Promise.all([
    Promise.all(symbols.map(s => fetchBenchmark(s))),
    fetchExchangeRates()
  ])

  benchmarkResults.forEach(data => {
    if (data) benchmarkCache[data.symbol] = data
  })

  if (rates) rateCache = rates
  lastFetchTime = Date.now()
}

// 获取缓存（自动刷新）
async function getCache() {
  if (Date.now() - lastFetchTime > CACHE_TTL) {
    await refreshCache()
  }
  return { benchmarks: benchmarkCache, rates: rateCache }
}

// 获取所有基准指数数据
export async function getBenchmarks() {
  const { benchmarks, rates } = await getCache()
  return {
    benchmarks: Object.values(benchmarks),
    rates: rates ?? { USDCNY: 0, HKDCNY: 0, updatedAt: 0 },
    isMarketOpen: isUSMarketOpen(),
    updatedAt: lastFetchTime
  }
}

// 估算单只 QDII 基金涨跌幅
export async function estimateFund(code: string): Promise<EstimateResult | null> {
  const fundInfo = (holdings.funds as any)[code]
  if (!fundInfo) return null

  const { benchmarks, rates } = await getCache()
  const benchmarkSymbol = Object.values(holdings.benchmarks).find(
    (b: any) => b.symbol === fundInfo.benchmark || b.symbol.replace('^', '') === fundInfo.benchmark
  ) as any

  const symbol = benchmarkSymbol?.symbol ?? fundInfo.benchmark
  const benchmarkData = benchmarks[symbol]
  if (!benchmarkData) return null

  const rateChange = fundInfo.currency === 'HKD'
    ? (rates?.HKDCNY ?? 0)
    : (rates?.USDCNY ?? 0)

  // 预估涨跌 = 基准涨跌 × 持仓权重 + 汇率变动 × 持仓权重
  const estimatedChange = (benchmarkData.changePercent + rateChange) * fundInfo.weight

  return {
    code,
    name: fundInfo.name,
    benchmark: symbol,
    benchmarkName: benchmarkData.name,
    estimatedChange: Math.round(estimatedChange * 100) / 100,
    benchmarkChange: Math.round(benchmarkData.changePercent * 100) / 100,
    rateChange: Math.round(rateChange * 100) / 100,
    updatedAt: benchmarkData.updatedAt,
    isMarketOpen: isUSMarketOpen()
  }
}

// 批量估算
export async function estimateFunds(codes: string[]): Promise<EstimateResult[]> {
  const results = await Promise.all(codes.map(code => estimateFund(code)))
  return results.filter(Boolean) as EstimateResult[]
}

// 获取所有已知 QDII 基金列表
export function getKnownFunds() {
  return Object.entries(holdings.funds as any).map(([code, info]: [string, any]) => ({
    code,
    name: info.name,
    benchmark: info.benchmark,
    currency: info.currency
  }))
}

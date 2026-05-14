// 持仓股票信息
export interface HoldingStock {
  rank: number
  stockCode: string      // 原始代码，如 116.03690
  symbol: string         // 标准化代码，如 hk00700 / NVDA / 600519
  name: string
  weight: number         // 占净值比例 %
  changePercent: number | null  // 实时涨跌幅 %
  market: 'HK' | 'US' | 'A'
}

export interface FundHoldings {
  fundCode: string
  fundName: string
  reportDate: string     // 截止日期
  totalHoldings: number  // 总持仓数
  stocks: HoldingStock[]
  estimatedChange: number | null  // 加权估值涨跌幅
  updatedAt: number
}

// 内存缓存：持仓数据24h，行情5min
const holdingsCache = new Map<string, { data: FundHoldings; expiry: number }>()
const quoteCache = new Map<string, { change: number; expiry: number }>()

const HOLDINGS_TTL = 24 * 60 * 60 * 1000
const QUOTE_TTL = 5 * 60 * 1000

// 判断市场类型
function detectMarket(rawCode: string): 'HK' | 'US' | 'A' {
  const prefix = rawCode.split('.')[0]
  if (prefix === '116') return 'HK'
  if (prefix === '105' || prefix === '106' || prefix === '107') return 'US'
  return 'A'
}

// 标准化股票代码
function normalizeCode(rawCode: string, market: 'HK' | 'US' | 'A'): string {
  const code = rawCode.split('.').slice(1).join('.') // 取 . 后面的部分
  if (market === 'HK') return `hk${code}`
  if (market === 'US') return code  // 直接用 AAPL / MSFT 等
  return code
}

// 抓取天天基金持仓数据
async function fetchHoldingsFromEastmoney(fundCode: string): Promise<{ stocks: Omit<HoldingStock, 'changePercent'>[]; reportDate: string; totalHoldings: number } | null> {
  try {
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topline=20&year=&month=&rt=${Math.random()}`
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://fundf10.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return null

    const text = await res.text()

    // 提取 content 字段中的 HTML
    const contentMatch = text.match(/content:"([\s\S]*?)",arryear/)
    if (!contentMatch) return null
    const html = contentMatch[1].replace(/\\"/g, '"').replace(/\\\//g, '/')

    // 提取报告日期（取最新一期）
    const dateMatch = html.match(/截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/)
    const reportDate = dateMatch?.[1] ?? ''

    // 只取第一个 table（最新季报）
    const firstTableMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/)
    if (!firstTableMatch) return null

    // 提取总持仓数（"共 XX 支"）
    const totalMatch = html.match(/共\s*(\d+)\s*支/)
    const totalHoldings = totalMatch ? parseInt(totalMatch[1]) : 0

    // 解析每行持仓
    const rows = firstTableMatch[1].match(/<tr>([\s\S]*?)<\/tr>/g) ?? []
    const stocks: Omit<HoldingStock, 'changePercent'>[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      // 提取股票代码（从 href 中）
      const codeMatch = row.match(/quote\.eastmoney\.com\/unify\/r\/(\d+\.[A-Z0-9]+)/i)
      if (!codeMatch) continue
      const rawCode = codeMatch[1]

      // 提取股票名称
      const nameMatch = row.match(/line-height:18px[^>]*><a[^>]*>([^<]+)<\/a>/)
      if (!nameMatch) continue
      const name = nameMatch[1].trim()

      // 提取占净值比例（最后一个 toc td 中的百分比）
      const weightMatches = row.match(/<td class='toc'>(\d+\.?\d*)%<\/td>/)
      if (!weightMatches) continue
      const weight = parseFloat(weightMatches[1])

      const market = detectMarket(rawCode)
      const symbol = normalizeCode(rawCode, market)

      stocks.push({ rank: i + 1, stockCode: rawCode, symbol, name, weight, market })
    }

    return { stocks, reportDate, totalHoldings }
  } catch (e) {
    console.error(`[Holdings] 抓取 ${fundCode} 持仓失败:`, e)
    return null
  }
}

// 获取港股行情（腾讯财经）
async function fetchHKQuote(symbol: string): Promise<number | null> {
  const cacheKey = `hk_${symbol}`
  const cached = quoteCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.change

  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
      headers: { 'Referer': 'https://finance.qq.com' },
      signal: AbortSignal.timeout(5000)
    })
    const text = await res.text()
    // 格式: v_hk00700="100~腾讯控股~00700~460.2~462.6~...~-0.52~..."
    // 第32个字段是涨跌幅
    const parts = text.split('~')
    if (parts.length < 33) return null
    const change = parseFloat(parts[32])
    if (isNaN(change)) return null

    quoteCache.set(cacheKey, { change, expiry: Date.now() + QUOTE_TTL })
    return change
  } catch {
    return null
  }
}

// 获取美股行情（Yahoo Finance）
async function fetchUSQuote(symbol: string): Promise<number | null> {
  const cacheKey = `us_${symbol}`
  const cached = quoteCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.change

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    )
    const json = await res.json() as any
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) return null

    const price = meta.regularMarketPrice ?? 0
    const prev = meta.chartPreviousClose ?? price
    const change = prev > 0 ? ((price - prev) / prev) * 100 : 0

    quoteCache.set(cacheKey, { change, expiry: Date.now() + QUOTE_TTL })
    return Math.round(change * 100) / 100
  } catch {
    return null
  }
}

// 获取A股行情（腾讯财经）
async function fetchAQuote(symbol: string): Promise<number | null> {
  const cacheKey = `a_${symbol}`
  const cached = quoteCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.change

  try {
    // A股代码：6开头是上交所(sh)，0/3开头是深交所(sz)
    const prefix = symbol.startsWith('6') ? 'sh' : 'sz'
    const res = await fetch(`https://qt.gtimg.cn/q=${prefix}${symbol}`, {
      headers: { 'Referer': 'https://finance.qq.com' },
      signal: AbortSignal.timeout(5000)
    })
    const text = await res.text()
    const parts = text.split('~')
    if (parts.length < 33) return null
    const change = parseFloat(parts[32])
    if (isNaN(change)) return null

    quoteCache.set(cacheKey, { change, expiry: Date.now() + QUOTE_TTL })
    return change
  } catch {
    return null
  }
}

// 批量获取行情
async function fetchQuotes(stocks: Omit<HoldingStock, 'changePercent'>[]): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>()

  await Promise.all(stocks.map(async (stock) => {
    let change: number | null = null
    if (stock.market === 'HK') {
      change = await fetchHKQuote(stock.symbol)
    } else if (stock.market === 'US') {
      change = await fetchUSQuote(stock.symbol)
    } else {
      change = await fetchAQuote(stock.symbol)
    }
    results.set(stock.symbol, change)
  }))

  return results
}

// 主入口：获取基金持仓详情（含实时行情）
export async function getFundHoldings(fundCode: string, fundName: string): Promise<FundHoldings | null> {
  // 检查缓存
  const cached = holdingsCache.get(fundCode)
  if (cached && Date.now() < cached.expiry) {
    // 持仓结构用缓存，但行情重新拉
    const quotes = await fetchQuotes(cached.data.stocks)
    const stocks = cached.data.stocks.map(s => ({
      ...s,
      changePercent: quotes.get(s.symbol) ?? null
    }))
    const estimatedChange = calcEstimatedChange(stocks)
    return { ...cached.data, stocks, estimatedChange, updatedAt: Date.now() }
  }

  // 抓取持仓
  const holdingsData = await fetchHoldingsFromEastmoney(fundCode)
  if (!holdingsData) return null

  // 批量获取行情
  const quotes = await fetchQuotes(holdingsData.stocks)

  const stocks: HoldingStock[] = holdingsData.stocks.map(s => ({
    ...s,
    changePercent: quotes.get(s.symbol) ?? null
  }))

  const estimatedChange = calcEstimatedChange(stocks)

  const result: FundHoldings = {
    fundCode,
    fundName,
    reportDate: holdingsData.reportDate,
    totalHoldings: holdingsData.totalHoldings,
    stocks,
    estimatedChange,
    updatedAt: Date.now()
  }

  // 缓存持仓结构24h
  holdingsCache.set(fundCode, {
    data: { ...result, stocks: holdingsData.stocks.map(s => ({ ...s, changePercent: null })) },
    expiry: Date.now() + HOLDINGS_TTL
  })

  return result
}

// 加权估值计算
function calcEstimatedChange(stocks: HoldingStock[]): number | null {
  const validStocks = stocks.filter(s => s.changePercent !== null)
  if (validStocks.length === 0) return null

  const totalWeight = validStocks.reduce((sum, s) => sum + s.weight, 0)
  if (totalWeight === 0) return null

  const weighted = validStocks.reduce((sum, s) => sum + s.changePercent! * s.weight, 0)
  return Math.round((weighted / totalWeight) * 100) / 100
}

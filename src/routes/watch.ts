import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import prisma from '../utils/prisma'

const router = Router()

// 手表专用接口 - 一次请求获取所有自选基金的实时估值数据
// GET /api/watch/funds
// 返回: { funds: [{ code, name, gszzl, gsz, dwjz, jzrq, gztime }], updatedAt }
router.get('/funds', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId

    // 1. 获取用户自选基金列表
    const userFunds = await prisma.userFund.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' }
    })

    if (userFunds.length === 0) {
      return res.json({ funds: [], updatedAt: new Date().toISOString() })
    }

    // 2. 批量获取所有基金的估值数据（腾讯财经，一次请求）
    const codes = userFunds.map(uf => uf.fundCode)
    const fundDataMap = await fetchTencentFundsBatch(codes)

    const funds = userFunds.map((uf) => {
      const data = fundDataMap.get(uf.fundCode) || {}
      return {
        code: uf.fundCode,
        name: uf.fundName,
        gszzl: data.gszzl || null,    // 估算涨跌幅（交易时间内有值）
        gsz: data.gsz || null,        // 估算净值（交易时间内有值）
        dwjz: data.dwjz || null,      // 单位净值（最新确权）
        jzrq: data.jzrq || null,      // 净值日期
        gztime: data.gztime || null,  // 估值时间（腾讯接口暂无）
      }
    })

    res.json({
      funds,
      updatedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Watch funds error:', error)
    res.status(500).json({ error: '获取基金数据失败' })
  }
})

// 从腾讯财经批量获取基金数据
// 字段格式: code~name~gsz~gszzl~[4]~dwjz~累计净值~zzl~jzrq~
// 交易时间内 gsz/gszzl 为实时估值；收市后为 0
async function fetchTencentFundsBatch(codes: string[]): Promise<Map<string, {
  gszzl?: string
  gsz?: string
  dwjz?: string
  jzrq?: string
  gztime?: string
}>> {
  const result = new Map<string, { gszzl?: string; gsz?: string; dwjz?: string; jzrq?: string; gztime?: string }>()
  if (codes.length === 0) return result

  // 腾讯支持批量查询，用逗号分隔，单次最多 100 支
  const BATCH_SIZE = 50
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE)
    const query = batch.map(c => `jj${c}`).join(',')
    const url = `https://qt.gtimg.cn/q=${query}`

    const response = await fetch(url, {
      headers: {
        'Referer': 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; JiguWatch/1.0)'
      }
    })

    if (!response.ok) {
      console.error(`腾讯财经批量接口异常: HTTP ${response.status}`)
      continue
    }

    // 响应为 GBK 编码
    const buf = await response.arrayBuffer()
    const text = new TextDecoder('gbk').decode(buf)

    // 逐条解析: v_jjCODE="fields~"
    const lineRe = /v_jj(\d+)="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = lineRe.exec(text)) !== null) {
      const code = m[1]
      const parts = m[2].split('~')
      if (parts.length < 9) continue

      const gsz = parts[2] && parts[2] !== '0.0000' ? parts[2] : undefined
      const gszzl = parts[3] && parts[3] !== '0.0000' ? parts[3] : undefined
      const dwjz = parts[5] || undefined
      const jzrq = parts[8] ? parts[8].slice(0, 10) : undefined

      result.set(code, { gsz, gszzl, dwjz, jzrq, gztime: undefined })
    }
  }

  return result
}

// 获取基金 top10 重仓股
// GET /api/watch/stocks/:code
router.get('/stocks/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const code = req.params.code as string
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: '无效的基金代码' })
    }

    const stocks = await fetchTopStocks(code)
    res.json({ code, stocks })
  } catch (error) {
    console.error('Watch stocks error:', error)
    res.status(500).json({ error: '获取重仓股数据失败' })
  }
})

// 从天天基金获取 top10 重仓股
async function fetchTopStocks(code: string): Promise<Array<{ name: string; pct: string }>> {
  const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`

  const response = await fetch(url, {
    headers: {
      'Referer': 'https://fundf10.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; JiguWatch/1.0)'
    }
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const text = await response.text()

  // 解析 HTML 表格，只取最新一期（第一个 table）
  const stocks: Array<{ name: string; pct: string }> = []

  // 匹配第一个 tbody 中的行
  const tbodyMatch = text.match(/<tbody>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) return stocks

  const tbody = tbodyMatch[1]
  // 匹配每一行: <tr><td>序号</td><td>代码</td><td class='tol'>名称</td>...占净值比例...</tr>
  const rowRegex = /<tr><td>\d+<\/td><td>.*?<\/td><td class='tol'><a[^>]*>(.*?)<\/a><\/td>.*?<td class='tor'>([\d.]+%)<\/td><td class='tor'>[\d,.]+<\/td><td class='tor last ccs'>[\d,.]+<\/td><\/tr>/g

  let match
  while ((match = rowRegex.exec(tbody)) !== null) {
    stocks.push({
      name: match[1],
      pct: match[2]
    })
  }

  // 如果上面的正则没匹配到（HTML 结构可能变化），用更宽松的方式
  if (stocks.length === 0) {
    const looseRegex = /<td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>([\d.]+%)<\/td>/g
    let looseMatch
    let count = 0
    while ((looseMatch = looseRegex.exec(tbody)) !== null && count < 10) {
      stocks.push({
        name: looseMatch[1],
        pct: looseMatch[2]
      })
      count++
    }
  }

  return stocks
}

export default router

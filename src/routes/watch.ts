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
    const fundDataMap = await fetchTiantianFundsBatch(codes)

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

// 从天天基金新接口批量获取基金估值数据
// 接口: https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast
// 替代已挂掉的 fundgz.1234567.com.cn JSONP 接口
// 交易时间内 GSZZL/GSZ 有实时估值；收市后为 null
async function fetchTiantianFundsBatch(codes: string[]): Promise<Map<string, {
  gszzl?: string
  gsz?: string
  dwjz?: string
  jzrq?: string
  gztime?: string
}>> {
  const result = new Map<string, { gszzl?: string; gsz?: string; dwjz?: string; jzrq?: string; gztime?: string }>()
  if (codes.length === 0) return result

  const BATCH_SIZE = 50
  const FIELDS = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE'

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE)
    const url = `https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES=${encodeURIComponent(batch.join(','))}&FIELDS=${encodeURIComponent(FIELDS)}`

    try {
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://fund.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; JiguWatch/1.0)'
        }
      })

      if (!response.ok) {
        console.error(`天天基金估值接口异常: HTTP ${response.status}`)
        continue
      }

      const json = await response.json() as {
        success: boolean
        data: Array<{
          FCODE: string
          GSZ: number | null
          GSZZL: number | null
          GZTIME: string | null
          NAV: number | null
          PDATE: string | null
        }>
      }

      if (!json.success || !Array.isArray(json.data)) {
        console.error('天天基金估值接口返回异常')
        continue
      }

      for (const item of json.data) {
        const code = item.FCODE?.trim()
        if (!code) continue

        result.set(code, {
          gsz: item.GSZ != null ? String(item.GSZ) : undefined,
          gszzl: item.GSZZL != null ? String(item.GSZZL) : undefined,
          dwjz: item.NAV != null ? String(item.NAV) : undefined,
          jzrq: item.PDATE ? item.PDATE.slice(0, 10) : undefined,
          gztime: item.GZTIME ?? undefined,
        })
      }
    } catch (e) {
      console.error(`天天基金估值接口请求失败:`, e)
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

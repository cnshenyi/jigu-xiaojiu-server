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

    // 2. 并行获取所有基金的估值数据
    const fundDataPromises = userFunds.map(async (uf) => {
      try {
        const data = await fetchFundEstimation(uf.fundCode)
        return {
          code: uf.fundCode,
          name: uf.fundName,
          gszzl: data.gszzl || null,    // 估算涨跌幅
          gsz: data.gsz || null,        // 估算净值
          dwjz: data.dwjz || null,      // 单位净值（最新确权）
          jzrq: data.jzrq || null,      // 净值日期
          gztime: data.gztime || null,   // 估值时间
        }
      } catch (e) {
        console.error(`获取基金 ${uf.fundCode} 数据失败:`, e)
        return {
          code: uf.fundCode,
          name: uf.fundName,
          gszzl: null,
          gsz: null,
          dwjz: null,
          jzrq: null,
          gztime: null,
        }
      }
    })

    const funds = await Promise.all(fundDataPromises)

    res.json({
      funds,
      updatedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Watch funds error:', error)
    res.status(500).json({ error: '获取基金数据失败' })
  }
})

// 从天天基金获取估值数据（服务端版本，不用 JSONP）
async function fetchFundEstimation(code: string): Promise<{
  gszzl?: string
  gsz?: string
  dwjz?: string
  jzrq?: string
  gztime?: string
}> {
  // 天天基金的 JSONP 接口，服务端直接请求并解析
  const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`

  const response = await fetch(url, {
    headers: {
      'Referer': 'https://fund.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; JiguWatch/1.0)'
    }
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const text = await response.text()

  // 解析 jsonpgz({...}) 格式
  const match = text.match(/jsonpgz\((.+)\)/)
  if (!match) {
    throw new Error('无法解析基金数据')
  }

  const data = JSON.parse(match[1])

  // 同时获取腾讯的最新确权净值
  let tencentData: { dwjz?: string; jzrq?: string; zzl?: number } = {}
  try {
    tencentData = await fetchTencentFundData(code)
  } catch (e) {
    // 腾讯数据获取失败不影响主流程
  }

  // 合并数据：腾讯的净值日期更新时优先使用
  let dwjz = data.dwjz
  let jzrq = data.jzrq || ''

  if (tencentData.jzrq && (!jzrq || tencentData.jzrq >= jzrq)) {
    dwjz = tencentData.dwjz || dwjz
    jzrq = tencentData.jzrq
  }

  return {
    gszzl: data.gszzl,
    gsz: data.gsz,
    dwjz,
    jzrq,
    gztime: data.gztime,
  }
}

// 从腾讯财经获取最新确权净值（服务端版本）
async function fetchTencentFundData(code: string): Promise<{
  dwjz?: string
  jzrq?: string
  zzl?: number
}> {
  const url = `https://qt.gtimg.cn/q=jj${code}`

  const response = await fetch(url, {
    headers: {
      'Referer': 'https://gu.qq.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; JiguWatch/1.0)'
    }
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const text = await response.text()

  // 解析格式: v_jj000001="...~净值~...~涨跌幅~净值日期~..."
  const match = text.match(/v_jj\d+="(.+)"/)
  if (!match) return {}

  const parts = match[1].split('~')
  if (parts.length <= 8) return {}

  return {
    dwjz: parts[5] || undefined,
    zzl: parts[7] ? parseFloat(parts[7]) : undefined,
    jzrq: parts[8] ? parts[8].slice(0, 10) : undefined,
  }
}

// 获取基金 top10 重仓股
// GET /api/watch/stocks/:code
router.get('/stocks/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const code = req.params.code
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

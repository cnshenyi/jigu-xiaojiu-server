import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getBenchmarks, estimateFunds, estimateFund } from '../services/qdii'
import { getFundHoldings } from '../services/holdings'
import prisma from '../utils/prisma'

const router = Router()

router.use(authMiddleware)

// 获取基金持仓详情（含实时行情）
router.get('/holdings/:code', async (req: AuthRequest, res) => {
  try {
    const code = req.params.code as string
    // 从用户自选里找基金名称，找不到就用代码代替
    const userFund = await prisma.userQdiiFund.findFirst({
      where: { userId: req.user!.userId, fundCode: code }
    })
    const fundName = userFund?.fundName ?? code
    const result = await getFundHoldings(code, fundName)
    if (!result) {
      return res.status(404).json({ error: '暂无持仓数据' })
    }
    res.json(result)
  } catch (error) {
    console.error('Get holdings error:', error)
    res.status(500).json({ error: '获取持仓数据失败' })
  }
})

// 获取基准指数 + 汇率
router.get('/benchmarks', async (req: AuthRequest, res) => {
  try {
    const data = await getBenchmarks()
    res.json(data)
  } catch (error) {
    console.error('Get benchmarks error:', error)
    res.status(500).json({ error: '获取指数数据失败' })
  }
})

// 通过代码或关键词搜索基金（支持自定义添加）
router.get('/search', async (req: AuthRequest, res) => {
  try {
    const { q } = req.query as { q: string }
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: '请输入至少2个字符' })
    }
    const keyword = q.trim()
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com' }
    })
    const json = await resp.json() as any
    const datas = (json.Datas || []) as any[]
    // 只返回 QDII 相关基金
    const results = datas
      .filter((d: any) => {
        const ftype: string = d.FundBaseInfo?.FTYPE || ''
        const name: string = d.NAME || ''
        return ftype.includes('海外') || ftype.includes('QDII') || name.includes('QDII') || name.includes('(QDII')
      })
      .slice(0, 10)
      .map((d: any) => ({
        code: d.CODE,
        name: d.NAME,
        type: d.FundBaseInfo?.FTYPE || ''
      }))
    res.json(results)
  } catch (error) {
    console.error('Search fund error:', error)
    res.status(500).json({ error: '搜索失败' })
  }
})

// 估算单只基金
router.get('/estimate/:code', async (req: AuthRequest, res) => {
  try {
    const result = await estimateFund(req.params.code as string)
    if (!result) {
      return res.status(404).json({ error: '暂不支持该基金的估值计算' })
    }
    res.json(result)
  } catch (error) {
    console.error('Estimate fund error:', error)
    res.status(500).json({ error: '估值计算失败' })
  }
})

// 获取用户 QDII 自选列表（含估值）
router.get('/funds', async (req: AuthRequest, res) => {
  try {
    const userFunds = await prisma.userQdiiFund.findMany({
      where: { userId: req.user!.userId },
      orderBy: { sortOrder: 'asc' }
    })

    const fundsWithNames = userFunds.map(f => ({ code: f.fundCode, name: f.fundName }))
    const estimates = await estimateFunds(fundsWithNames)

    // 合并用户自选和估值数据
    const result = userFunds.map(f => {
      const estimate = estimates.find(e => e.code === f.fundCode)
      return {
        code: f.fundCode,
        name: f.fundName,
        sortOrder: f.sortOrder,
        estimate: estimate ?? null
      }
    })

    res.json(result)
  } catch (error) {
    console.error('Get QDII funds error:', error)
    res.status(500).json({ error: '获取自选列表失败' })
  }
})

// 添加 QDII 自选
router.post('/funds', async (req: AuthRequest, res) => {
  try {
    const { code, name } = req.body
    if (!code || !name) {
      return res.status(400).json({ error: '基金代码和名称不能为空' })
    }

    const existing = await prisma.userQdiiFund.findUnique({
      where: {
        userId_fundCode: {
          userId: req.user!.userId,
          fundCode: code
        }
      }
    })
    if (existing) {
      return res.status(400).json({ error: '该基金已在自选列表中' })
    }

    const maxSort = await prisma.userQdiiFund.aggregate({
      where: { userId: req.user!.userId },
      _max: { sortOrder: true }
    })

    const fund = await prisma.userQdiiFund.create({
      data: {
        userId: req.user!.userId,
        fundCode: code,
        fundName: name,
        sortOrder: (maxSort._max.sortOrder || 0) + 1
      }
    })

    res.json({ code: fund.fundCode, name: fund.fundName, sortOrder: fund.sortOrder })
  } catch (error) {
    console.error('Add QDII fund error:', error)
    res.status(500).json({ error: '添加基金失败' })
  }
})

// 删除 QDII 自选
router.delete('/funds/:code', async (req: AuthRequest, res) => {
  try {
    await prisma.userQdiiFund.delete({
      where: {
        userId_fundCode: {
          userId: req.user!.userId,
          fundCode: req.params.code as string
        }
      }
    })
    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Delete QDII fund error:', error)
    res.status(500).json({ error: '删除基金失败' })
  }
})

export default router

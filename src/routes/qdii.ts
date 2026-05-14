import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getBenchmarks, estimateFunds, estimateFund, getKnownFunds } from '../services/qdii'
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

// 获取所有已知 QDII 基金列表（用于搜索/添加）
router.get('/known', async (req: AuthRequest, res) => {
  try {
    res.json(getKnownFunds())
  } catch (error) {
    res.status(500).json({ error: '获取基金列表失败' })
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

    const codes = userFunds.map(f => f.fundCode)
    const estimates = await estimateFunds(codes)

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

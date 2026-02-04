import { Router } from 'express'
import prisma from '../utils/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// 所有基金路由都需要认证
router.use(authMiddleware)

// 获取用户自选基金列表
router.get('/', async (req: AuthRequest, res) => {
  try {
    const funds = await prisma.userFund.findMany({
      where: { userId: req.user!.userId },
      orderBy: { sortOrder: 'asc' }
    })
    
    res.json(funds.map(f => ({
      code: f.fundCode,
      name: f.fundName,
      sortOrder: f.sortOrder
    })))
  } catch (error) {
    console.error('Get funds error:', error)
    res.status(500).json({ error: '获取基金列表失败' })
  }
})

// 添加自选基金
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { code, name } = req.body
    
    if (!code || !name) {
      return res.status(400).json({ error: '基金代码和名称不能为空' })
    }
    
    // 检查是否已添加
    const existing = await prisma.userFund.findUnique({
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
    
    // 获取当前最大排序值
    const maxSort = await prisma.userFund.aggregate({
      where: { userId: req.user!.userId },
      _max: { sortOrder: true }
    })
    
    const fund = await prisma.userFund.create({
      data: {
        userId: req.user!.userId,
        fundCode: code,
        fundName: name,
        sortOrder: (maxSort._max.sortOrder || 0) + 1
      }
    })
    
    res.json({
      code: fund.fundCode,
      name: fund.fundName,
      sortOrder: fund.sortOrder
    })
  } catch (error) {
    console.error('Add fund error:', error)
    res.status(500).json({ error: '添加基金失败' })
  }
})

// 删除自选基金
router.delete('/:code', async (req: AuthRequest, res) => {
  try {
    const code = req.params.code as string
    
    await prisma.userFund.delete({
      where: {
        userId_fundCode: {
          userId: req.user!.userId,
          fundCode: code
        }
      }
    })
    
    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Delete fund error:', error)
    res.status(500).json({ error: '删除基金失败' })
  }
})

// 调整排序
router.put('/order', async (req: AuthRequest, res) => {
  try {
    const { codes } = req.body // 按顺序排列的基金代码数组
    
    if (!Array.isArray(codes)) {
      return res.status(400).json({ error: '无效的排序数据' })
    }
    
    // 批量更新排序
    await Promise.all(
      codes.map((code: string, index: number) =>
        prisma.userFund.updateMany({
          where: {
            userId: req.user!.userId,
            fundCode: code
          },
          data: { sortOrder: index }
        })
      )
    )
    
    res.json({ message: '排序更新成功' })
  } catch (error) {
    console.error('Update order error:', error)
    res.status(500).json({ error: '更新排序失败' })
  }
})

export default router

import { Router } from 'express'
import prisma from '../utils/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// 所有分组路由都需要认证
router.use(authMiddleware)

// 获取用户分组
router.get('/', async (req: AuthRequest, res) => {
  try {
    const groups = await prisma.userGroup.findMany({
      where: { userId: req.user!.userId },
      orderBy: { sortOrder: 'asc' }
    })
    
    res.json(groups.map(g => ({
      id: g.id,
      name: g.name,
      codes: g.fundCodes,
      sortOrder: g.sortOrder
    })))
  } catch (error) {
    console.error('Get groups error:', error)
    res.status(500).json({ error: '获取分组失败' })
  }
})

// 创建分组
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { name, codes = [] } = req.body
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: '分组名称不能为空' })
    }
    
    // 获取当前最大排序值
    const maxSort = await prisma.userGroup.aggregate({
      where: { userId: req.user!.userId },
      _max: { sortOrder: true }
    })
    
    const group = await prisma.userGroup.create({
      data: {
        userId: req.user!.userId,
        name: name.trim(),
        fundCodes: codes,
        sortOrder: (maxSort._max.sortOrder || 0) + 1
      }
    })
    
    res.json({
      id: group.id,
      name: group.name,
      codes: group.fundCodes,
      sortOrder: group.sortOrder
    })
  } catch (error) {
    console.error('Create group error:', error)
    res.status(500).json({ error: '创建分组失败' })
  }
})

// 更新分组
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string
    const { name, codes } = req.body
    
    const updateData: any = {}
    
    if (name !== undefined) {
      if (name.trim().length === 0) {
        return res.status(400).json({ error: '分组名称不能为空' })
      }
      updateData.name = name.trim()
    }
    
    if (codes !== undefined) {
      updateData.fundCodes = codes
    }
    
    const group = await prisma.userGroup.updateMany({
      where: {
        id: id,
        userId: req.user!.userId
      },
      data: updateData
    })
    
    if (group.count === 0) {
      return res.status(404).json({ error: '分组不存在' })
    }
    
    const updated = await prisma.userGroup.findUnique({
      where: { id: id }
    })
    
    res.json({
      id: updated!.id,
      name: updated!.name,
      codes: updated!.fundCodes,
      sortOrder: updated!.sortOrder
    })
  } catch (error) {
    console.error('Update group error:', error)
    res.status(500).json({ error: '更新分组失败' })
  }
})

// 删除分组
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string
    
    const result = await prisma.userGroup.deleteMany({
      where: {
        id: id,
        userId: req.user!.userId
      }
    })
    
    if (result.count === 0) {
      return res.status(404).json({ error: '分组不存在' })
    }
    
    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Delete group error:', error)
    res.status(500).json({ error: '删除分组失败' })
  }
})

export default router

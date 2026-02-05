import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { AuthRequest, authMiddleware } from '../middleware/auth'

const router = Router()
const prisma = new PrismaClient()

// 获取用户的所有提醒设置
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    
    const alerts = await prisma.alertSetting.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json(alerts)
  } catch (error) {
    console.error('Get alerts error:', error)
    res.status(500).json({ error: '获取提醒设置失败' })
  }
})

// 获取单个基金的提醒设置
router.get('/:fundCode', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    const fundCode = req.params.fundCode as string
    
    const alert = await prisma.alertSetting.findUnique({
      where: {
        userId_fundCode: { userId, fundCode }
      }
    })
    
    res.json(alert)
  } catch (error) {
    console.error('Get alert error:', error)
    res.status(500).json({ error: '获取提醒设置失败' })
  }
})

// 创建或更新提醒设置
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    const { fundCode, fundName, riseThreshold, fallThreshold, targetNavHigh, targetNavLow, enabled } = req.body
    
    if (!fundCode || !fundName) {
      return res.status(400).json({ error: '基金代码和名称不能为空' })
    }
    
    // 至少设置一个阈值
    if (!riseThreshold && !fallThreshold && !targetNavHigh && !targetNavLow) {
      return res.status(400).json({ error: '请至少设置一个提醒条件' })
    }
    
    const alert = await prisma.alertSetting.upsert({
      where: {
        userId_fundCode: { userId, fundCode }
      },
      update: {
        fundName,
        riseThreshold: riseThreshold || null,
        fallThreshold: fallThreshold || null,
        targetNavHigh: targetNavHigh || null,
        targetNavLow: targetNavLow || null,
        enabled: enabled !== false,
        lastTriggered: null // 重置触发时间
      },
      create: {
        userId,
        fundCode,
        fundName,
        riseThreshold: riseThreshold || null,
        fallThreshold: fallThreshold || null,
        targetNavHigh: targetNavHigh || null,
        targetNavLow: targetNavLow || null,
        enabled: enabled !== false
      }
    })
    
    res.json(alert)
  } catch (error) {
    console.error('Create/update alert error:', error)
    res.status(500).json({ error: '保存提醒设置失败' })
  }
})

// 切换提醒开关
router.patch('/:id/toggle', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string
    const userId = req.user!.userId
    
    const alert = await prisma.alertSetting.findFirst({
      where: { id, userId }
    })
    
    if (!alert) {
      return res.status(404).json({ error: '提醒设置不存在' })
    }
    
    const updated = await prisma.alertSetting.update({
      where: { id },
      data: { enabled: !alert.enabled }
    })
    
    res.json(updated)
  } catch (error) {
    console.error('Toggle alert error:', error)
    res.status(500).json({ error: '切换提醒状态失败' })
  }
})

// 删除提醒设置
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string
    const userId = req.user!.userId
    
    await prisma.alertSetting.deleteMany({
      where: { id, userId }
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Delete alert error:', error)
    res.status(500).json({ error: '删除提醒设置失败' })
  }
})

export default router

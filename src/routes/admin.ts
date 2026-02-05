import { Router } from 'express'
import prisma from '../utils/prisma'
import { sendSSEToUser, broadcastSSE } from './messages'

const router = Router()

// 管理员密钥验证中间件
const adminAuth = (req: any, res: any, next: any) => {
  const adminKey = req.headers['x-admin-key']
  const expectedKey = process.env.ADMIN_KEY || 'jigu-admin-2026'
  
  if (adminKey !== expectedKey) {
    return res.status(401).json({ error: '无权限访问' })
  }
  next()
}

router.use(adminAuth)

// 生成随机邀请码
function generateCode(length: number = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // 去掉容易混淆的 I, O
  let code = ''
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// 批量生成邀请码
router.post('/invite-codes', async (req, res) => {
  try {
    const { count = 10, note = '' } = req.body
    
    if (count < 1 || count > 100) {
      return res.status(400).json({ error: '数量需在 1-100 之间' })
    }
    
    const codes: string[] = []
    const existingCodes = new Set(
      (await prisma.inviteCode.findMany({ select: { code: true } }))
        .map(c => c.code)
    )
    
    // 生成不重复的邀请码
    while (codes.length < count) {
      const code = generateCode()
      if (!existingCodes.has(code) && !codes.includes(code)) {
        codes.push(code)
      }
    }
    
    // 批量插入
    await prisma.inviteCode.createMany({
      data: codes.map(code => ({ code, note }))
    })
    
    res.json({
      message: `成功生成 ${count} 个邀请码`,
      codes
    })
  } catch (error) {
    console.error('Generate invite codes error:', error)
    res.status(500).json({ error: '生成邀请码失败' })
  }
})

// 获取所有邀请码
router.get('/invite-codes', async (req, res) => {
  try {
    const codes = await prisma.inviteCode.findMany({
      include: {
        usedBy: {
          select: { name: true, phone: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json(codes.map(c => ({
      code: c.code,
      used: !!c.usedById,
      usedBy: c.usedBy ? `${c.usedBy.name} (${c.usedBy.phone})` : null,
      usedAt: c.usedAt,
      note: c.note,
      createdAt: c.createdAt
    })))
  } catch (error) {
    console.error('Get invite codes error:', error)
    res.status(500).json({ error: '获取邀请码失败' })
  }
})

// 删除邀请码
router.delete('/invite-codes/:code', async (req, res) => {
  try {
    const { code } = req.params
    
    const result = await prisma.inviteCode.deleteMany({
      where: { code }
    })
    
    if (result.count === 0) {
      return res.status(404).json({ error: '邀请码不存在' })
    }
    
    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Delete invite code error:', error)
    res.status(500).json({ error: '删除邀请码失败' })
  }
})

// 发送系统消息
router.post('/send-message', async (req, res) => {
  try {
    const { title, content, type = 'system', phone } = req.body
    
    if (!title || !content) {
      return res.status(400).json({ error: '标题和内容不能为���' })
    }
    
    let userId = null
    
    // 如果指定了手机号，查找用户
    if (phone) {
      const user = await prisma.user.findUnique({
        where: { phone }
      })
      if (!user) {
        return res.status(404).json({ error: '用户不存在' })
      }
      userId = user.id
    }
    
    const message = await prisma.message.create({
      data: {
        userId,
        type,
        title,
        content
      }
    })
    
    // 通过 SSE 实时推送消息
    const sseData = {
      type: 'new_message',
      message
    }
    
    if (userId) {
      // 发送给指定用户
      sendSSEToUser(userId, sseData)
    } else {
      // 广播给所有用户
      broadcastSSE(sseData)
    }
    
    res.json({
      message: '发送成功',
      data: message
    })
  } catch (error) {
    console.error('Send message error:', error)
    res.status(500).json({ error: '发送消息失败' })
  }
})

// 获取所有用户
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    })
    res.json(users)
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ error: '获取用户列表失败' })
  }
})

export default router

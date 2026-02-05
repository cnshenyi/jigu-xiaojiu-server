import { Router, Response, Request } from 'express'
import { PrismaClient } from '@prisma/client'
import { AuthRequest, authMiddleware } from '../middleware/auth'
import { verifyToken } from '../utils/jwt'

const router = Router()
const prisma = new PrismaClient()

// SSE 连接存储
const sseClients = new Map<string, Response[]>()

// 发送 SSE 消息给指定用户
export function sendSSEToUser(userId: string, data: any) {
  const clients = sseClients.get(userId) || []
  clients.forEach(res => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  })
}

// 发送 SSE 消息给所有用户（广播）
export function broadcastSSE(data: any) {
  sseClients.forEach((clients) => {
    clients.forEach(res => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    })
  })
}

// SSE 连接端点 - 使用 query 参数传 token（因为 EventSource 不支持 headers）
router.get('/stream', (req: Request, res: Response) => {
  const token = req.query.token as string
  
  if (!token) {
    return res.status(401).json({ error: '未提供认证信息' })
  }
  
  let userId: string
  try {
    const payload = verifyToken(token)
    userId = payload.userId
  } catch (error) {
    return res.status(401).json({ error: '认证失败' })
  }
  
  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
  res.setHeader('Access-Control-Allow-Origin', '*')
  
  // 发送初始连接成功消息
  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`)
  
  // 添加到客户端列表
  if (!sseClients.has(userId)) {
    sseClients.set(userId, [])
  }
  sseClients.get(userId)!.push(res)
  
  console.log(`SSE connected: ${userId}, total clients: ${sseClients.get(userId)!.length}`)
  
  // 心跳保持连接
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`)
  }, 30000)
  
  // 连接关闭时清理
  req.on('close', () => {
    clearInterval(heartbeat)
    const clients = sseClients.get(userId) || []
    const index = clients.indexOf(res)
    if (index > -1) {
      clients.splice(index, 1)
    }
    if (clients.length === 0) {
      sseClients.delete(userId)
    }
    console.log(`SSE disconnected: ${userId}`)
  })
})

// 获取消息列表
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    const { unreadOnly, limit = '50' } = req.query
    
    const where: any = {
      OR: [
        { userId },
        { userId: null } // 系统广播消息
      ]
    }
    
    if (unreadOnly === 'true') {
      where.read = false
    }
    
    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit)
    })
    
    res.json(messages)
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ error: '获取消息失败' })
  }
})

// 获取未读消息数量
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    
    const count = await prisma.message.count({
      where: {
        OR: [
          { userId },
          { userId: null }
        ],
        read: false
      }
    })
    
    res.json({ count })
  } catch (error) {
    console.error('Get unread count error:', error)
    res.status(500).json({ error: '获取未读数量失败' })
  }
})

// 标记消息已读
router.post('/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string
    
    await prisma.message.update({
      where: { id },
      data: { read: true }
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Mark read error:', error)
    res.status(500).json({ error: '标记已读失败' })
  }
})

// 全部标记已读
router.post('/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    
    await prisma.message.updateMany({
      where: {
        OR: [
          { userId },
          { userId: null }
        ],
        read: false
      },
      data: { read: true }
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Mark all read error:', error)
    res.status(500).json({ error: '标记全部已读失败' })
  }
})

// 删除消息
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string
    
    await prisma.message.delete({
      where: { id }
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Delete message error:', error)
    res.status(500).json({ error: '删除消息失败' })
  }
})

// 清空所有消息
router.delete('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    
    await prisma.message.deleteMany({
      where: {
        OR: [
          { userId },
          { userId: null }
        ]
      }
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Clear messages error:', error)
    res.status(500).json({ error: '清空消息失败' })
  }
})

export default router

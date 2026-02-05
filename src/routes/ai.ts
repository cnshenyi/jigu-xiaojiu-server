import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { recognizeFundsFromImage, chat, ChatMessage, FundContext } from '../services/doubao'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

// 图片识别基金
router.post('/recognize-funds', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { image } = req.body

    if (!image) {
      return res.status(400).json({ error: '请上传图片' })
    }

    // 检查 API Key 是否配置
    if (!process.env.DOUBAO_API_KEY) {
      return res.status(500).json({ error: 'AI 服务未配置' })
    }

    // 调用豆包识别
    const funds = await recognizeFundsFromImage(image)

    res.json({
      success: true,
      funds,
      count: funds.length
    })
  } catch (error: any) {
    console.error('图片识别失败:', error)
    res.status(500).json({ 
      error: '识别失败，请重试',
      detail: error.message 
    })
  }
})

// AI 聊天
router.post('/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { message, history, fundData } = req.body
    const userId = req.user?.userId

    if (!message) {
      return res.status(400).json({ error: '请输入问题' })
    }

    if (!process.env.DOUBAO_API_KEY) {
      return res.status(500).json({ error: 'AI 服务未配置' })
    }

    // 使用前端传来的基金数据作为上下文
    // 前端已经有实时估值数据，直接使用更准确
    const fundContext: FundContext[] = fundData || []

    // 调用 AI 聊天
    const reply = await chat(
      message,
      fundContext,
      (history || []) as ChatMessage[]
    )

    res.json({
      success: true,
      reply
    })
  } catch (error: any) {
    console.error('AI 聊天失败:', error)
    res.status(500).json({ 
      error: '小九暂时无法回答，请稍后再试',
      detail: error.message 
    })
  }
})

export default router

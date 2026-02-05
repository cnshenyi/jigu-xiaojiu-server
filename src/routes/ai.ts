import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { recognizeFundsFromImage, chat, chatStream, type ChatMessage, type FundContext } from '../services/doubao'

const router = Router()

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

// AI 聊天（流式）
router.post('/chat/stream', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { message, history, fundData } = req.body

    if (!message) {
      return res.status(400).json({ error: '请输入问题' })
    }

    if (!process.env.DOUBAO_API_KEY) {
      return res.status(500).json({ error: 'AI 服务未配置' })
    }

    const fundContext: FundContext[] = fundData || []

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲

    // 流式输出
    const stream = chatStream(
      message,
      fundContext,
      (history || []) as ChatMessage[]
    )

    for await (const chunk of stream) {
      // SSE 格式：data: xxx\n\n
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
    }

    // 发送结束标记
    res.write(`data: [DONE]\n\n`)
    res.end()
  } catch (error: any) {
    console.error('AI 流式聊天失败:', error)
    // 如果还没开始流式输出，返回 JSON 错误
    if (!res.headersSent) {
      res.status(500).json({ 
        error: '小九暂时无法回答，请稍后再试',
        detail: error.message 
      })
    } else {
      // 已经开始流式输出，发送错误事件
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
      res.end()
    }
  }
})

// AI 聊天（非流式，保留兼容）
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

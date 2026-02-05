import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { recognizeFundsFromImage } from '../services/doubao'

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

export default router

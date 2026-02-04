import { Router } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../utils/prisma'
import { generateToken } from '../utils/jwt'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// 注册
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, avatar = 'male' } = req.body
    
    // 验证必填字段
    if (!name || !phone || !password) {
      return res.status(400).json({ error: '请填写完整信息' })
    }
    
    // 验证手机号格式
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' })
    }
    
    // 验证密码长度
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' })
    }
    
    // 检查手机号是否已注册
    const existingUser = await prisma.user.findUnique({
      where: { phone }
    })
    
    if (existingUser) {
      return res.status(400).json({ error: '该手机号已注册' })
    }
    
    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10)
    
    // 创建用户
    const user = await prisma.user.create({
      data: {
        name,
        phone,
        passwordHash,
        avatar
      }
    })
    
    // 生成 token
    const token = generateToken({ userId: user.id, phone: user.phone })
    
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar: user.avatar
      }
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ error: '注册失败，请稍后重试' })
  }
})

// 登录
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body
    
    if (!phone || !password) {
      return res.status(400).json({ error: '请输入手机号和密码' })
    }
    
    console.log('Login attempt for phone:', phone)
    
    // 查找用户
    const user = await prisma.user.findUnique({
      where: { phone }
    })
    
    if (!user) {
      return res.status(400).json({ error: '手机号或密码错误' })
    }
    
    // 验证密码
    const isValid = await bcrypt.compare(password, user.passwordHash)
    
    if (!isValid) {
      return res.status(400).json({ error: '手机号或密码错误' })
    }
    
    // 生成 token
    const token = generateToken({ userId: user.id, phone: user.phone })
    
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar: user.avatar
      }
    })
  } catch (error: any) {
    console.error('Login error:', error.message || error)
    res.status(500).json({ error: '登录失败，请稍后重试', detail: error.message })
  }
})

// 获取当前用户信息
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId }
    })
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    res.json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar
    })
  } catch (error) {
    console.error('Get me error:', error)
    res.status(500).json({ error: '获取用户信息失败' })
  }
})

export default router

import { Router } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../utils/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// 所有用户路由都需要认证
router.use(authMiddleware)

// 更新个人信息
router.put('/profile', async (req: AuthRequest, res) => {
  try {
    const { name } = req.body
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: '姓名不能为空' })
    }
    
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { name: name.trim() }
    })
    
    res.json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: '更新失败' })
  }
})

// 修改密码
router.put('/password', async (req: AuthRequest, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请填写完整信息' })
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6位' })
    }
    
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId }
    })
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    // 验证旧密码
    const isValid = await bcrypt.compare(oldPassword, user.passwordHash)
    
    if (!isValid) {
      return res.status(400).json({ error: '原密码错误' })
    }
    
    // 更新密码
    const passwordHash = await bcrypt.hash(newPassword, 10)
    
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { passwordHash }
    })
    
    res.json({ message: '密码修改成功' })
  } catch (error) {
    console.error('Update password error:', error)
    res.status(500).json({ error: '修改密码失败' })
  }
})

// 更换头像
router.put('/avatar', async (req: AuthRequest, res) => {
  try {
    const { avatar } = req.body
    
    if (!['male', 'female'].includes(avatar)) {
      return res.status(400).json({ error: '无效的头像类型' })
    }
    
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatar }
    })
    
    res.json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar
    })
  } catch (error) {
    console.error('Update avatar error:', error)
    res.status(500).json({ error: '更换头像失败' })
  }
})

export default router

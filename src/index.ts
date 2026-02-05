import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth'
import userRoutes from './routes/user'
import fundRoutes from './routes/fund'
import groupRoutes from './routes/group'
import adminRoutes from './routes/admin'
import messageRoutes from './routes/messages'
import alertRoutes from './routes/alerts'
import aiRoutes from './routes/ai'
import { startAlertChecker } from './services/alertChecker'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json({ limit: '10mb' })) // 增加限制以支持图片上传

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/funds', fundRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/alerts', alertRoutes)
app.use('/api/ai', aiRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  
  // 启动提醒检查服务
  startAlertChecker()
})

export default app

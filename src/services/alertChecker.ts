import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 基金数据接口
interface FundData {
  fundcode: string
  name: string
  dwjz: string  // 单位净值
  gsz: string   // 估算值
  gszzl: string // 估算涨跌幅
  gztime: string
}

// 获取基金实时数据
async function getFundData(code: string): Promise<FundData | null> {
  try {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://fund.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    if (!response.ok) return null
    
    const text = await response.text()
    // 解析 jsonpgz({...}) 格式
    const match = text.match(/jsonpgz\((.*)\)/)
    if (!match) return null
    
    return JSON.parse(match[1])
  } catch (error) {
    console.error(`获取基金 ${code} 数据失败:`, error)
    return null
  }
}

// 检查单个提醒是否触发
async function checkAlert(alert: any, fundData: FundData): Promise<string | null> {
  const changePercent = parseFloat(fundData.gszzl)
  const currentNav = parseFloat(fundData.gsz)
  
  const triggers: string[] = []
  
  // 检查涨幅阈值
  if (alert.riseThreshold && changePercent >= alert.riseThreshold) {
    triggers.push(`涨幅达到 ${changePercent.toFixed(2)}%（阈值 ${alert.riseThreshold}%）`)
  }
  
  // 检查跌幅阈值
  if (alert.fallThreshold && changePercent <= -alert.fallThreshold) {
    triggers.push(`跌幅达到 ${changePercent.toFixed(2)}%（阈值 -${alert.fallThreshold}%）`)
  }
  
  // 检查目标净值（高）
  if (alert.targetNavHigh && currentNav >= alert.targetNavHigh) {
    triggers.push(`估值达到 ${currentNav.toFixed(4)}（目标 ${alert.targetNavHigh}）`)
  }
  
  // 检查目标净值（低）
  if (alert.targetNavLow && currentNav <= alert.targetNavLow) {
    triggers.push(`估值达到 ${currentNav.toFixed(4)}（目标 ${alert.targetNavLow}）`)
  }
  
  if (triggers.length === 0) return null
  
  return triggers.join('；')
}

// 发送消息通知
async function sendAlertMessage(userId: string, fundName: string, fundCode: string, triggerReason: string) {
  try {
    await prisma.message.create({
      data: {
        userId,
        title: `📊 ${fundName} 提醒`,
        content: triggerReason,
        type: triggerReason.includes('涨') ? 'rise' : 'fall'
      }
    })
    console.log(`已发送提醒消息给用户 ${userId}: ${fundName} - ${triggerReason}`)
  } catch (error) {
    console.error('发送提醒消息失败:', error)
  }
}

// 主检查函数
export async function checkAllAlerts() {
  console.log(`[${new Date().toISOString()}] 开始检查提醒...`)
  
  try {
    // 获取所有启用的提醒
    const alerts = await prisma.alertSetting.findMany({
      where: { enabled: true }
    })
    
    if (alerts.length === 0) {
      console.log('没有启用的提醒')
      return
    }
    
    console.log(`找到 ${alerts.length} 个启用的提醒`)
    
    // 按基金代码分组，避免重复请求
    const fundCodes = [...new Set(alerts.map(a => a.fundCode))]
    const fundDataMap = new Map<string, FundData>()
    
    // 获取所有基金数据
    for (const code of fundCodes) {
      const data = await getFundData(code)
      if (data) {
        fundDataMap.set(code, data)
      }
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    
    // 检查每个提醒
    for (const alert of alerts) {
      const fundData = fundDataMap.get(alert.fundCode)
      if (!fundData) continue
      
      // 检查是否在冷却期（同一提醒 1 小时内不重复触发）
      if (alert.lastTriggered) {
        const cooldownMs = 60 * 60 * 1000 // 1 小时
        if (Date.now() - alert.lastTriggered.getTime() < cooldownMs) {
          continue
        }
      }
      
      const triggerReason = await checkAlert(alert, fundData)
      if (triggerReason) {
        // 发送消息
        await sendAlertMessage(alert.userId, alert.fundName, alert.fundCode, triggerReason)
        
        // 更新触发时间
        await prisma.alertSetting.update({
          where: { id: alert.id },
          data: { lastTriggered: new Date() }
        })
      }
    }
    
    console.log(`[${new Date().toISOString()}] 提醒检查完成`)
  } catch (error) {
    console.error('检查提醒时出错:', error)
  }
}

// 启动定时检查（每 5 分钟）
export function startAlertChecker() {
  console.log('启动提醒检查服务...')
  
  // 立即执行一次
  checkAllAlerts()
  
  // 每 5 分钟检查一次
  const intervalMs = 5 * 60 * 1000
  setInterval(() => {
    // 只在交易时间检查（9:30-15:00，周一到周五）
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const day = now.getDay()
    
    // 周末不检查
    if (day === 0 || day === 6) return
    
    // 非交易时间不检查
    const timeNum = hour * 100 + minute
    if (timeNum < 930 || timeNum > 1500) return
    
    checkAllAlerts()
  }, intervalMs)
}

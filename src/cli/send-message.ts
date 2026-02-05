#!/usr/bin/env npx ts-node

/**
 * 管理员命令行工具 - 发送系统消息
 * 
 * 用法:
 *   npx ts-node src/cli/send-message.ts --title "标题" --content "内容"
 *   npx ts-node src/cli/send-message.ts --title "标题" --content "内容" --user <userId>
 * 
 * 参数:
 *   --title    消息标题
 *   --content  消息内容
 *   --user     指定用户ID（可选，不指定则广播给所有用户）
 *   --type     消息类型（默认 system）
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  
  // 解析参数
  const params: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '')
    const value = args[i + 1]
    params[key] = value
  }
  
  if (!params.title || !params.content) {
    console.log(`
📢 发送系统消息工具

用法:
  npx ts-node src/cli/send-message.ts --title "标题" --content "内容"
  npx ts-node src/cli/send-message.ts --title "标题" --content "内容" --user <userId>

参数:
  --title    消息标题（必填）
  --content  消息内容（必填）
  --user     指定用户ID（可选，不指定则广播给所有用户）
  --type     消息类型（可选，默认 system）

示例:
  npx ts-node src/cli/send-message.ts --title "系统维护通知" --content "系统将于今晚22:00进行维护"
    `)
    process.exit(1)
  }
  
  const { title, content, user: userId, type = 'system' } = params
  
  try {
    const message = await prisma.message.create({
      data: {
        userId: userId || null, // null 表示广播
        type,
        title,
        content
      }
    })
    
    console.log('✅ 消息发送成功!')
    console.log(`   ID: ${message.id}`)
    console.log(`   类型: ${type}`)
    console.log(`   标题: ${title}`)
    console.log(`   内容: ${content}`)
    console.log(`   目标: ${userId || '所有用户（广播）'}`)
    console.log(`   时间: ${message.createdAt}`)
    
    // 如果有 SSE 连接，这里可以触发推送
    // 但 CLI 工具无法直接访问运行中的服务器 SSE 连接
    // 可以通过 HTTP 请求触发，或者让客户端轮询
    
  } catch (error) {
    console.error('❌ 发送失败:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

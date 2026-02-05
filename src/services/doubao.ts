import OpenAI from 'openai'

// 豆包 API 配置（兼容 OpenAI 接口）
const doubao = new OpenAI({
  apiKey: process.env.DOUBAO_API_KEY || '',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  timeout: 30000 // 30 秒超时
})

// 豆包模型（统一使用 seed-1.8）
const MODEL = process.env.DOUBAO_MODEL || 'doubao-seed-1-8-251228'

// 从图片中识别基金代码
export async function recognizeFundsFromImage(imageBase64: string): Promise<Array<{ code: string; name: string }>> {
  console.log('[doubao] 开始识别图片，模型:', MODEL)
  console.log('[doubao] API Key 已配置:', !!process.env.DOUBAO_API_KEY)
  console.log('[doubao] 图片大小:', Math.round(imageBase64.length / 1024), 'KB')
  
  try {
    const response = await doubao.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `请从这张图片中识别所有基金信息。

要求：
1. 只提取6位数字的基金代码
2. 如果能识别到基金名称也一并提取
3. 返回 JSON 数组格式，例如：[{"code": "110022", "name": "易方达消费行业"}]
4. 如果识别不到基金代码，返回空数组 []
5. 只返回 JSON，不要其他文字`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      max_tokens: 1000
    })

    const content = response.choices[0]?.message?.content || '[]'
    console.log('[doubao] AI 返回内容:', content)
    
    // 尝试解析 JSON
    try {
      // 提取 JSON 部分（可能被包裹在 markdown 代码块中）
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const funds = JSON.parse(jsonMatch[0])
        // 验证格式
        const validFunds = funds.filter((f: any) => 
          f.code && /^\d{6}$/.test(f.code)
        ).map((f: any) => ({
          code: f.code,
          name: f.name || ''
        }))
        console.log('[doubao] 识别到基金:', validFunds.length, '只')
        return validFunds
      }
    } catch (parseError) {
      console.error('[doubao] 解析 AI 返回的 JSON 失败:', parseError)
    }
    
    return []
  } catch (error: any) {
    console.error('[doubao] 调用豆包 API 失败:', error.message)
    console.error('[doubao] 错误详情:', error.response?.data || error)
    throw error
  }
}

// 聊天消息类型
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// 基金数据类型（用于上下文）
export interface FundContext {
  code: string
  name: string
  gsz?: string      // 估值
  gszzl?: string    // 估值涨跌幅
  dwjz?: string     // 单位净值
  jzrq?: string     // 净值日期
}

// AI 聊天
export async function chat(
  message: string, 
  fundContext: FundContext[],
  history: ChatMessage[] = []
): Promise<string> {
  console.log('[doubao] 开始聊天，模型:', MODEL)
  console.log('[doubao] 用户消息:', message)
  console.log('[doubao] 持仓数量:', fundContext.length)
  
  // 构建系统提示词
  const systemPrompt = `你是"小九"，基估小99的AI助手，专门帮助用户分析基金持仓。

## 你的性格
- 专业但亲切，像一个懂投资的朋友
- 回答简洁有条理，避免啰嗦
- 适当使用 emoji 让对话更生动

## 用户当前持仓
${fundContext.length > 0 ? fundContext.map(f => 
  `- ${f.name}(${f.code}): 估值 ${f.gsz || '--'}, 涨跌 ${f.gszzl || '--'}%`
).join('\n') : '用户暂无持仓'}

## 注意事项
- 基于用户的真实持仓数据回答
- 如果用户问的基金不在持仓中，可以提供一般性建议
- 不要编造数据，如果不确定就说明
- 投资建议要谨慎，提醒用户注意风险`

  try {
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ]

    const response = await doubao.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 1000,
      temperature: 0.7
    })

    const reply = response.choices[0]?.message?.content || '抱歉，我没有理解你的问题。'
    console.log('[doubao] AI 回复:', reply.substring(0, 100) + '...')
    return reply
  } catch (error: any) {
    console.error('[doubao] 聊天失败:', error.message)
    throw error
  }
}

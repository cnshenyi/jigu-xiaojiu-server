import OpenAI from 'openai'

// 豆包 API 配置（兼容 OpenAI 接口）
const doubao = new OpenAI({
  apiKey: process.env.DOUBAO_API_KEY || '',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3'
})

// 豆包视觉模型 endpoint
const VISION_MODEL = process.env.DOUBAO_VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115'

// 从图片中识别基金代码
export async function recognizeFundsFromImage(imageBase64: string): Promise<Array<{ code: string; name: string }>> {
  try {
    const response = await doubao.chat.completions.create({
      model: VISION_MODEL,
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
    
    // 尝试解析 JSON
    try {
      // 提取 JSON 部分（可能被包裹在 markdown 代码块中）
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const funds = JSON.parse(jsonMatch[0])
        // 验证格式
        return funds.filter((f: any) => 
          f.code && /^\d{6}$/.test(f.code)
        ).map((f: any) => ({
          code: f.code,
          name: f.name || ''
        }))
      }
    } catch (parseError) {
      console.error('解析 AI 返回的 JSON 失败:', parseError)
    }
    
    return []
  } catch (error) {
    console.error('调用豆包 API 失败:', error)
    throw error
  }
}

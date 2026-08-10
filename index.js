const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ========== 原有的上报接口（保持不变）==========
app.post('/track', async (req, res) => {
  const { device, app_name, action, event_time } = req.body;
  const { data, error } = await supabase.from('usage_logs').insert([{
    device, app_name, action,
    event_time: event_time || new Date().toISOString()
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ========== MCP 标准接口（新增）==========

// 1. 初始化握手
app.post('/mcp', async (req, res) => {
  const { method, params, id } = req.body;
  
  // 初始化请求
  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        protocolVersion: '0.1.0',
        capabilities: { tools: {} },
        serverInfo: { name: 'usage-tracker', version: '1.0.0' }
      }
    });
  }
  
  // 列出工具
  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        tools: [{
          name: 'query_usage',
          description: '查询微信使用时长记录',
          inputSchema: {
            type: 'object',
            properties: {
              days: { type: 'string', description: '查询最近几天，默认1' }
            }
          }
        }]
      }
    });
  }
  
  // 调用工具
  if (method === 'tools/call') {
    const days = params?.arguments?.days || '1';
    const date = new Date();
    date.setDate(date.getDate() - parseInt(days));
    const fromDate = date.toISOString();
    
    const { data, error } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('device', 'iPhone')
      .eq('app_name', '微信')
      .gte('created_at', fromDate)
      .order('created_at', { ascending: false });
    
    if (error) {
      return res.json({
        jsonrpc: '2.0',
        id: id,
        result: { content: [{ type: 'text', text: `查询失败: ${error.message}` }] }
      });
    }
    
    const openCount = data.filter(r => r.action === 'open').length;
    const closeCount = data.filter(r => r.action === 'close').length;
    const text = `最近 ${days} 天，微信共打开 ${openCount} 次，关闭 ${closeCount} 次，总记录 ${data.length} 条。`;
    
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: { content: [{ type: 'text', text: text }] }
    });
  }
  
  // 其他方法返回空
  res.json({ jsonrpc: '2.0', id: id, result: {} });
});

app.get('/', (req, res) => res.send('Tracking server is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

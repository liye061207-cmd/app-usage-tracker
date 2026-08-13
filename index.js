const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---- 上报接口（不变） ----
app.post('/track', async (req, res) => {
  const { device, app_name, action, event_time } = req.body;
  const { data, error } = await supabase.from('usage_logs').insert([{
    device, app_name, action,
    event_time: event_time || new Date().toISOString()
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ---- MCP 服务器 ----
app.all('/mcp', async (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    return;
  }

  const { jsonrpc, id, method, params } = req.body;

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0', id: id,
      result: {
        protocolVersion: '0.1.0',
        capabilities: { tools: {} },
        serverInfo: { name: 'usage-tracker', version: '1.1.0' },
        _meta: { connected: true }
      }
    });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0', id: id,
      result: {
        tools: [
          {
            name: 'query_app_usage',
            description: '查询任意 App 的使用次数和时长（支持微信、小红书、抖音等）',
            inputSchema: {
              type: 'object',
              properties: {
                app_name: { type: 'string', description: 'App 名称，如“微信”“小红书”“抖音”' },
                days: { type: 'integer', description: '最近几天，默认1' }
              },
              required: ['app_name']
            }
          },
          {
            name: 'save_memory',
            description: '保存一条长期记忆（类型：情绪/身体/约定/关系/一般）',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '要记住的内容' },
                type: { type: 'string', description: '记忆类型，默认general' }
              },
              required: ['content']
            }
          },
          {
            name: 'get_memories',
            description: '读取最近的记忆',
            inputSchema: {
              type: 'object',
              properties: {
                days: { type: 'integer', description: '最近几天，默认7' },
                limit: { type: 'integer', description: '最多几条，默认20' }
              }
            }
          }
        ],
        _meta: { count: 3 }
      }
    });
  }

  if (method === 'tools/call') {
    // 从多个可能的位置取工具名（兼容不同客户端）
    const toolName = params?.name || params?.tool || params?.arguments?._tool || params?.arguments?.tool || '';
    const args = params?.arguments || {};

    console.log('🔍 收到的工具名:', toolName);
    console.log('📦 参数:', args);

    // ---- 保存记忆 ----
    if (toolName === 'save_memory') {
      console.log('save_memory called:', JSON.stringify(args));
      const content = String(args.content || '').trim();
      if (!content) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: '请提供要记住的内容。' }] } });
      }
      const type = String(args.type || 'general').trim();
      const { data, error } = await supabase.from('memories').insert([{ content, type }]);
      if (error) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: `保存记忆失败: ${error.message}` }] } });
      }
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: '已记住。' }] } });
    }

    // ---- 读取记忆 ----
    if (toolName === 'get_memories') {
      const days = parseInt(args.days) || 7;
      const limit = parseInt(args.limit) || 20;
      const date = new Date();
      date.setDate(date.getDate() - days);
      const { data, error } = await supabase
        .from('memories')
        .select('content, type, created_at')
        .gte('created_at', date.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: `读取记忆失败: ${error.message}` }] } });
      }
      if (!data || data.length === 0) {
        return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: '最近没有记忆。' }] } });
      }
      const text = data.map(m => `[${m.type}] ${m.content}`).join('\n');
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text }] } });
    }

    // ---- 查岗（原有逻辑） ----
    const app_name = args.app_name;
    const days = args.days || 1;

    if (!app_name) {
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: '请告诉我你想查询哪个 App，例如“微信”或“小红书”。' }] } });
    }

    const date = new Date();
    date.setDate(date.getDate() - parseInt(days));
    const fromDate = date.toISOString();

    const { data, error } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('device', 'iPhone')
      .eq('app_name', app_name)
      .gte('created_at', fromDate)
      .order('created_at', { ascending: true });

    if (error) {
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: `查询失败: ${error.message}` }] } });
    }

    if (data.length === 0) {
      return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text: `最近 ${days} 天没有找到“${app_name}”的使用记录。` }] } });
    }

    let totalSeconds = 0;
    let openTime = null;
    let openCount = 0;
    let closeCount = 0;

    for (const record of data) {
      if (record.action === 'open') {
        openTime = new Date(record.event_time);
        openCount++;
      } else if (record.action === 'close' && openTime) {
        const closeTime = new Date(record.event_time);
        const diff = Math.floor((closeTime - openTime) / 1000);
        if (diff > 0) totalSeconds += diff;
        openTime = null;
        closeCount++;
      }
    }

    if (openTime) {
      const now = new Date();
      const diff = Math.floor((now - openTime) / 1000);
      if (diff > 0) totalSeconds += diff;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    let timeStr = '';
    if (hours > 0) timeStr += `${hours}小时`;
    if (minutes > 0) timeStr += `${minutes}分钟`;
    if (secs > 0 || timeStr === '') timeStr += `${secs}秒`;

    const text = `最近 ${days} 天，“${app_name}”共打开 ${openCount} 次，关闭 ${closeCount} 次，总使用时长 ${timeStr}。`;

    return res.json({ jsonrpc, id, result: { content: [{ type: 'text', text }] } });
  }

  res.json({ jsonrpc: '2.0', id: id, result: {}, _meta: {} });
});

app.get('/', (req, res) => res.send('Tracking server is running'));
app.listen(process.env.PORT || 3000, () => console.log('Listening...'));

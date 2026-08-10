const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

// 跨域支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---- 上报接口 ----
app.post('/track', async (req, res) => {
  const { device, app_name, action, event_time } = req.body;
  const { data, error } = await supabase.from('usage_logs').insert([{
    device, app_name, action,
    event_time: event_time || new Date().toISOString()
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ---- MCP 服务器（包含时长计算） ----
app.all('/mcp', async (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    return;
  }

  const { jsonrpc, id, method, params } = req.body;

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        protocolVersion: '0.1.0',
        capabilities: { tools: {} },
        serverInfo: { name: 'usage-tracker', version: '1.0.0' },
        _meta: { connected: true }
      }
    });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        tools: [{
          name: 'query_wechat_usage',
          description: '查询手机微信使用次数和时长',
          inputSchema: {
            type: 'object',
            properties: {
              days: { type: 'integer', description: '最近几天，默认1' }
            }
          }
        }],
        _meta: { count: 1 }
      }
    });
  }

  if (method === 'tools/call') {
    const days = params?.arguments?.days || 1;
    const date = new Date();
    date.setDate(date.getDate() - parseInt(days));
    const fromDate = date.toISOString();

    const { data, error } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('device', 'iPhone')
      .eq('app_name', '微信')
      .gte('created_at', fromDate)
      .order('created_at', { ascending: true });

    if (error) {
      return res.json({
        jsonrpc: '2.0',
        id: id,
        result: {
          content: [{ type: 'text', text: `查询失败: ${error.message}` }],
          _meta: { success: false }
        }
      });
    }

    // ---- 计算总时长 ----
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

    // 如果最后还有未关闭的 open，算到当前时间
    if (openTime) {
      const now = new Date();
      const diff = Math.floor((now - openTime) / 1000);
      if (diff > 0) totalSeconds += diff;
    }

    // 格式化
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    let timeStr = '';
    if (hours > 0) timeStr += `${hours}小时`;
    if (minutes > 0) timeStr += `${minutes}分钟`;
    if (secs > 0 || timeStr === '') timeStr += `${secs}秒`;

    const text = `最近 ${days} 天，微信共打开 ${openCount} 次，关闭 ${closeCount} 次，总使用时长 ${timeStr}。`;

    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        content: [{ type: 'text', text: text }],
        _meta: { success: true, total: data.length, seconds: totalSeconds }
      }
    });
  }

  res.json({ jsonrpc: '2.0', id: id, result: {}, _meta: {} });
});

app.get('/', (req, res) => res.send('Tracking server is running'));
app.listen(process.env.PORT || 3000, () => console.log('Listening...'));

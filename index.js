const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 【写入接口】接收上报数据（已有）
app.post('/track', async (req, res) => {
  const { device, app_name, action, event_time } = req.body;
  const { data, error } = await supabase.from('usage_logs').insert([{
    device, app_name, action,
    event_time: event_time || new Date().toISOString()
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// 【查询接口】给 AI 调用的统计接口（新增！）
app.get('/stats', async (req, res) => {
  const { device, days = '1' } = req.query;
  const date = new Date();
  date.setDate(date.getDate() - parseInt(days));
  const fromDate = date.toISOString();

  let query = supabase
    .from('usage_logs')
    .select('*')
    .gte('created_at', fromDate);

  if (device) {
    query = query.eq('device', device);
  }

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // 返回 AI 容易理解的结构
  res.json({
    period: `最近 ${days} 天`,
    device: device || '全部设备',
    total_records: data.length,
    records: data.slice(0, 200) // 最多给200条，避免数据量过大
  });
});

app.get('/', (req, res) => res.send('Tracking server is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

// 从 Railway 环境变量读取（等会设置）
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 接收上报数据的接口
app.post('/track', async (req, res) => {
  const { device, app_name, action, event_time } = req.body;
  const { data, error } = await supabase.from('usage_logs').insert([{
    device, app_name, action,
    event_time: event_time || new Date().toISOString()
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// 测试根路径
app.get('/', (req, res) => res.send('Tracking server is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

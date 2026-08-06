const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'app_usage.json');

app.use(express.json());

// 接收 App 使用记录
app.post('/app-usage', (req, res) => {
  try {
    const { app, timestamp } = req.body;
    if (!app) {
      return res.status(400).json({ error: '缺少 app 字段' });
    }

    let data = [];
    if (fs.existsSync(DATA_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      } catch (e) {
        data = [];
      }
    }

    data.push({
      app: app,
      timestamp: timestamp || new Date().toISOString()
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    data = data.filter(entry => new Date(entry.timestamp) > sevenDaysAgo);

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    console.log(`✅ 已记录 App 使用: ${app}`);
    res.json({ success: true, app: app });
  } catch (err) {
    console.error('❌ 记录 App 使用失败:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 查询今日 App 使用记录
app.get('/today-apps', (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return res.json({ apps: [] });
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const today = new Date().toDateString();

    const todayApps = data
      .filter(entry => new Date(entry.timestamp).toDateString() === today)
      .map(entry => entry.app);

    res.json({ apps: todayApps });
  } catch (err) {
    console.error('❌ 查询今日 App 失败:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ App Usage Tracker 运行在端口 ${PORT}`);
});

import os
from fastapi import FastAPI, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import uvicorn

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.post("/api/upload")
async def upload_events(app_name: str, start_time: str, end_time: str, duration_seconds: int):
    supabase.table("app_sessions").insert({
        "app_name": app_name,
        "start_time": start_time,
        "end_time": end_time,
        "duration_seconds": duration_seconds
    }).execute()
    return {"status": "ok"}

from fastapi import FastAPI, Request, Form

@app.post("/api/upload")
async def upload_events(
    app_name: str = Form(...),
    start_time: str = Form(...),
    end_time: str = Form(...),
    duration_seconds: int = Form(...)
):
    supabase.table("app_sessions").insert({
        "app_name": app_name,
        "start_time": start_time,
        "end_time": end_time,
        "duration_seconds": duration_seconds
    }).execute()
    return {"status": "ok"}

@app.get("/api/status")
async def get_status():
    res = supabase.table("system_state").select("value").eq("key", "monitoring").execute()
    return {"monitoring": res.data[0]["value"]}

# 4. MCP 协议接口（给 Kelivo 用的）
@app.post("/mcp")
async def mcp_handler(request: Request):
    body = await request.json()
    method = body.get("method")
    req_id = body.get("id")
    
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}}
    
    if method == "tools/list":
        return {
            "jsonrpc": "2.0", "id": req_id,
            "result": {
                "tools": [{
                    "name": "query_app_usage",
                    "description": "查询某个应用在指定时间范围内的使用次数和总时长",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "app_name": {"type": "string"},
                            "start_time": {"type": "string"},
                            "end_time": {"type": "string"}
                        },
                        "required": ["app_name", "start_time", "end_time"]
                    }
                }]
            }
        }
    
    if method == "tools/call":
        params = body.get("params", {})
        args = params.get("arguments", {})
        if params.get("name") == "query_app_usage":
            res = supabase.table("app_sessions") \
                .select("duration_seconds") \
                .eq("app_name", args.get("app_name")) \
                .gte("start_time", args.get("start_time")) \
                .lte("end_time", args.get("end_time")) \
                .execute()
            durations = [item["duration_seconds"] for item in res.data if item["duration_seconds"]]
            total_sec = sum(durations) if durations else 0
            h = total_sec // 3600
            m = (total_sec % 3600) // 60
            s = total_sec % 60
            result_text = f"应用 {args.get('app_name')} 在指定时间打开 {len(res.data)} 次，总时长 {h}小时{m}分{s}秒"
            return {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": result_text}]}}
    
    return {"jsonrpc": "2.0", "id": req_id, "result": {}}

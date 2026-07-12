import uvicorn

if __name__ == "__main__":
    uvicorn.run("michikusa_agent.server:app", host="0.0.0.0", port=8081, reload=False)

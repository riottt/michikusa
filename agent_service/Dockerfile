# syntax=docker/dockerfile:1.7
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080
WORKDIR /app
RUN groupadd --system --gid 1001 michikusa && useradd --system --uid 1001 --gid michikusa michikusa
COPY agent_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY agent_service ./agent_service
ENV PYTHONPATH=/app/agent_service
USER michikusa
EXPOSE 8080
CMD ["sh", "-c", "uvicorn michikusa_agent.server:app --host 0.0.0.0 --port ${PORT:-8080}"]

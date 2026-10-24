FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TAGORA_VAR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY tagora ./tagora
RUN pip install --no-cache-dir ".[bench]"
COPY benchmarks ./benchmarks

# Seed the registry from the published public-split cards so the API has listings on first boot.
RUN python -m tagora.bootstrap --split hidden

EXPOSE 8787
VOLUME ["/data"]
CMD ["uvicorn", "tagora.api:app", "--host", "0.0.0.0", "--port", "8787"]

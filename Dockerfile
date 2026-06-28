FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt package.json ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY work ./work
COPY outputs/stock-helper-web ./outputs/stock-helper-web

ENV HOST=0.0.0.0
ENV PYTHON=python3

CMD ["npm", "start"]

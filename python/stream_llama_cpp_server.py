"""
Demo to stream response from llama-server from llama-cpp

REQUIRES: 
- LLAMA_CPP_HOST set and llama-server running on that host.
- Accessible server running `llama-server`. See example below. 
  ```
  llama-server \
    -m ./Hermes-3-Llama-3.1-8B.Q8_0.gguf \
    -ngl 999 \
    -c 4096 \
    -np 2 \
    --host 0.0.0.0 \
    --port 8080
  ```
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# load env vars
load_dotenv("../.env")

host = os.environ["LLAMA_CPP_HOST"]

client = OpenAI(
    base_url=f"{host}/v1",
    api_key="not-needed"
)

stream = client.chat.completions.create(
    model="local-model",
    messages=[
        {"role": "user", "content": "Explain why the sky is blue in one paragraph."}
    ],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta
    if delta.content:
        print(delta.content, end="", flush=True)

print()
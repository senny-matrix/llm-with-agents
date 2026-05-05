import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com/v1"
)

def simple_chat(user_msg, history=None):
    if history is None:
        history = [{"role": "system", "content": "You are a helpful AI assistant."}]
    history.append({"role": "user", "content": user_msg})
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=history,
        temperature=0.7
    )
    reply = response.choices[0].message.content
    history.append({"role": "assistant", "content": reply})
    return reply, history

# Example
reply, hist = simple_chat("What is an LLM in one sentence?")
print(reply)

# Run the script as follows
# export OPENAI_API_KEY=your_key_here && python3 chat_completation.py
### Note: The above code assumes you have the OpenAI Python client library 
# installed and properly configured with your API key.
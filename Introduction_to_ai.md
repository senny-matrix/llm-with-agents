# A Practical Developer's Guide to AI: From LLMs to Autonomous Agents

This tutorial is designed for developers who want to move beyond hype and build real AI-powered applications. You will learn the essential concepts, see working code using the DeepSeek API, and understand how modern LLMs are reshaping software development.

## 1. Brief History of AI - Why Now Is Different

- 1950 - 70s | Symbolic AI | logic, rules, expert systems.
  - Limitations: handcrafted rules don't scale
- 1990s - 2010s | Statistical ML | SVM, random forests, shallow neural nets.
  - Breakthrough | Computer Vision, Speech recognation - but language remained hard.
- 2017 - Transformer architecture (Attention Is All You Need).
  - Key ideas | parallel processing and self attention, enabling massive scale.
- 2020 - Large Language Models (GPT-3/4, DeepSeek, Llama).
  - Why revolutionary | few-short learning, reasoning, and code-generation emerge from scale - not explicitly programmed.

_For Developer_ | Pre 2020, solving a language task meant collecting labels, training a small model, and deploying fragile pipelines. Today, one API call with a well written prompt can outperform many custom model.

## The LLM Revolution - How they work (Enough to Be Dangerous)

### From Next-Token Prediction to Emergent Abilities

LLMs are trained to predict the next word (token) given previous ones. With billions of parameters and Internet-scale data, they learn:

- Syntax, semantics, reasoning, coding patterns, and een tool use.

### Key Capabilities

| Capability                 | What it means for your App                                        |
| :------------------------- | :---------------------------------------------------------------- |
| In-context learning        | Teach a task via examples in the prompt - no fine-tuning needed   |
| :---------------------     | :---------------------------------------------------------------- |
| Instruction Following      | "Write a Python function that..."                                 |
| :---------------------     | :---------------------------------------------------------------- |
| Reasoning                  | Chain of thought: "let us think step by step"                     |
| :---------------------     | :---------------------------------------------------------------- |
| Tool use /function calling | LLM decised to call your API, database, or run code               |

### Why DeepSeek? ###
DeepSeek offers OpenAI compatible API, high performance, and very low cost - perfect for building and teaching.

## 3. Chatbots & Prompt Engineering - The Baseline ###

### The anatomy of a Chatbot ###

A simple chatbot is a loop:
1. Collect user message.
2. Append to conversation history.
3. Call LLM with a system prompt (sets behaviour) + history.
4. Stream or return the answer.

### Prompt Engineering Basics (Must-Know Pattern)

a) System prompt - defines the assistant's personality

    ```python
        system_prompt = "You are a helpful coding assistant. Answer concisely with code examples."
    ```
b) Few-sjort examples - teach via demonstration
    ```text
        User: “Add two numbers in Python”
        Assistant: “def add(a,b): return a+b”

        User: “Find max of list”
        Assistant: “def max_list(lst): return max(lst)”
    ```

### Practical Code - DeepSeek Chat Completion

```python
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
```
#### Pro tip | Use temperature=0 for factual tasks, 0.7-1.0 for creativity

## 4. Using LLMs in Programming - Beyond Copilot

### Four Concrete Use Cases

#### 1. Code Generation & Auto-Completion


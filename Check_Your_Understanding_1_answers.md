# Answer to CYU

1. The generateText() function is used to generate text responses from a language model. You provide it with a model, a prompt (user message), and optionally a system prompt, and it returns generated text based on those inputs.
2. A system prompt is the base instructions for an LLM that primes it with its background and instructions. For example, it might contain instructions like "You are a helpful AI system. You provide clear, accurate and concise responses". This sets the context and behavior for how the LLM should respond to the user queries.
3. The provider adapter modules allow you to switch out different model providers (like OpenAI, Anthropic, DeepSeek, etc)while using the same SDK interface. This provides flexibility to change LLM providers without having to rewrite your code.
4. The three main parameters are:
    a) model - specifies which LLM model to use (GPT-4oini, DeepSeek-Chat, etc)
    b) prompt - the user message or input text, and
    c) the system prompt - the system prompt that provides base instructions to the LLM.
5. At its core, an LLM is simple: you give it some text (input), and it generates some text (output) in response. The complexity comes in building sophisticated agents that can hold conversations, perform tasks, and produce consistenly good results.
6. A
7. D
8. A
9. B

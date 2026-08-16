import OpenAI from "openai";

export async function askChatGPT(apiKey, systemPrompt, userMessage) {
    if (!apiKey) return null;
    try {
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemPrompt || "You are a helpful assistant." },
                { role: "user", content: userMessage }
            ],
            max_tokens: 150
        });
        return completion.choices[0].message.content;
    } catch (e) {
        console.error("OpenAI Error:", e.message);
        return null;
    }
}

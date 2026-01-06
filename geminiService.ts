
import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  async getChatResponse(prompt: string): Promise<string | undefined> {
    const apiKey = (process.env as any).API_KEY;
    if (!apiKey) return "Velo AI is offline. No API key provided.";

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          systemInstruction: 'You are Velo AI, a high-speed assistant. Be extremely concise and professional.',
        }
      });
      return response.text;
    } catch (error) {
      console.error("Gemini Error:", error);
      return "AI connection error.";
    }
  }
}


import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  /**
   * Fetches a response from the Gemini model.
   * Uses process.env.API_KEY directly as required.
   */
  async getChatResponse(prompt: string): Promise<string | undefined> {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return "Velo AI is offline. No API Key detected in Nexus environment.";

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          systemInstruction: 'You are Velo AI, a P2P networking assistant. Be extremely concise, technical, and helpful. Always emphasize privacy.',
        }
      });
      // Correct usage: Access response.text property directly
      return response.text;
    } catch (error) {
      console.error("Gemini Error:", error);
      return "The AI handshake failed. Retrying sync...";
    }
  }
}

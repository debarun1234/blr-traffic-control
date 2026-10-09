/** Default `generate` on Vertex AI via @google/genai (lazy import). Models come from settings. */
/** Gemini "thinking" tokens are counted inside maxOutputTokens, so a small limit can be spent on thinking and the visible
 *  answer is cut off mid-sentence. Keep thinking minimal: these are short operational texts, not reasoning problems. */
export const thinkingFor = (model) => /gemini-3/.test(model) ? { thinkingLevel: 'LOW' } : /2\.5-pro/.test(model) ? { thinkingBudget: 128 } : /2\.5/.test(model) ? { thinkingBudget: 0 } : null;
export function createVertexGenerate({ env = process.env } = {}) {
  let ai;
  return async ({ model, prompt, maxOutputTokens, signal }) => {
    if (!ai) {
      const { GoogleGenAI } = await import('@google/genai');
      ai = new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.VERTEX_LOCATION || env.GOOGLE_CLOUD_LOCATION || 'global' });
    }
    const thinking = thinkingFor(model);
    const r = await ai.models.generateContent({ model, contents: prompt, config: { maxOutputTokens, temperature: 0.3, abortSignal: signal, ...(thinking ? { thinkingConfig: thinking } : {}) } });
    const u = r.usageMetadata ?? {};
    return { text: r.text ?? '', tokensIn: u.promptTokenCount, tokensOut: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), truncated: r.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
  };
}

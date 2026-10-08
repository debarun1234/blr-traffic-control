/** Default `generate` on Vertex AI via @google/genai (lazy import). Models come from settings. */
export function createVertexGenerate({ env = process.env } = {}) {
  let ai;
  return async ({ model, prompt, maxOutputTokens, signal }) => {
    if (!ai) {
      const { GoogleGenAI } = await import('@google/genai');
      ai = new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.VERTEX_LOCATION || env.GOOGLE_CLOUD_LOCATION || 'global' });
    }
    const r = await ai.models.generateContent({ model, contents: prompt, config: { maxOutputTokens, temperature: 0.3, abortSignal: signal } });
    return { text: r.text ?? '', tokensIn: r.usageMetadata?.promptTokenCount, tokensOut: r.usageMetadata?.candidatesTokenCount };
  };
}

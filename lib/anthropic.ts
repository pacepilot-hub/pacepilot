const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// ⚠️ Ne jamais mettre la clé API ici — utiliser une Supabase Edge Function

export async function callHaiku(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1000
): Promise<string> {
  const response = await fetch("/api/ai", { // → Edge Function Supabase
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) throw new Error("Erreur API IA");
  const data = await response.json();
  return data.content[0].text;
}
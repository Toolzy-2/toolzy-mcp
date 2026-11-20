/**
 * Vérification du domaine mcp.toolzy.io par OpenAI pour l'app ChatGPT
 * (plugin asdk_app_6b00296ca6b481919749505de7442b13). OpenAI attend le jeton seul,
 * en texte brut. Ce jeton n'est pas un secret : il prouve seulement que nous
 * contrôlons le domaine, et il est lu publiquement par OpenAI.
 */
const OPENAI_APPS_CHALLENGE_TOKEN = "_5iIPJuHeTecn9wvAzm04eQselfTra1zX5kHzh8sDs0";

export function GET(): Response {
  return new Response(OPENAI_APPS_CHALLENGE_TOKEN, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

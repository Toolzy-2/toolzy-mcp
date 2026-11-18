// Vérifie l'URL de connexion du serveur d'autorisation (MCP_AUTH_DATABASE_URL)
// avant de la mettre dans Vercel. N'affiche jamais l'URL ni le mot de passe.
// Usage : MCP_AUTH_DATABASE_URL=... node scripts/check-auth-db.mjs
import pg from "pg";

const url = process.env.MCP_AUTH_DATABASE_URL;
if (!url) {
  console.error("MCP_AUTH_DATABASE_URL est vide.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
let ok = true;
try {
  const { rows: path } = await pool.query("show search_path");
  const searchPathOk = path[0]?.search_path === "mcp_auth";
  console.log(searchPathOk ? "1/3 OK  search_path = mcp_auth" : `1/3 KO  search_path = ${path[0]?.search_path}`);
  ok &&= searchPathOk;

  const { rows: clients } = await pool.query('select count(*)::int as n from "oauthClient"');
  console.log(`2/3 OK  tables du serveur d'autorisation lisibles (${clients[0].n} client)`);

  try {
    await pool.query("select 1 from public.users limit 1");
    console.log("3/3 KO  ANOMALIE : ce rôle peut lire public.users");
    ok = false;
  } catch {
    console.log("3/3 OK  public.users refusé, comme prévu");
  }
} catch (error) {
  console.error(`ÉCHEC : ${error.message}`);
  ok = false;
} finally {
  await pool.end();
}
console.log(ok ? "\nTout est bon : tu peux mettre cette URL dans Vercel." : "\nProblème : envoie-moi les lignes ci-dessus (sans l'URL).");
process.exit(ok ? 0 : 1);

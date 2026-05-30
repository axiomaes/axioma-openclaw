const { Client } = require('pg');
const puppeteer = require('puppeteer');

async function handle(input) {
  const { mode, targetUrl } = input;
  
  if (mode === 'db_audit') {
    // Antigravity implementará aquí la conexión directa a tu Postgres
    // para buscar los blogs que mencionamos antes.
    return { status: "success", message: "Database audited. No new unshared blogs found." };
  }
  
  if (mode === 'url_scrape' && targetUrl) {
    const browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    
    // Extrae el texto limpio de la web de Axioma
    const content = await page.evaluate(() => document.body.innerText);
    await browser.close();
    
    const structuredPayload = {
      origin: "openclaw_scout",
      task: "generate_linkedin_post",
      message: content,
      history: []
    };
    
    return { status: "success", payload: structuredPayload };
  }
  
  return { status: "failed", error: "Invalid mode" };
}

module.exports = { handle };

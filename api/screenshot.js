const chromium = require("@sparticuz/chromium-min");
const puppeteer = require("puppeteer-core");

// Remote Chromium build that matches @sparticuz/chromium-min v131
const CHROMIUM_PACK_URL =
  "https://github.com/nichochar/chromium-for-lambda/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

// Vercel serverless function config
module.exports.config = {
  maxDuration: 60,
};

module.exports = async function handler(req, res) {
  // ── CORS headers ──────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── Extract HTML from request ─────────────────────────────────────
  let html;
  const contentType = (req.headers["content-type"] || "").toLowerCase();

  if (contentType.includes("application/json")) {
    html = req.body?.html;
  } else if (
    contentType.includes("text/html") ||
    contentType.includes("text/plain")
  ) {
    html = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } else {
    html = req.body?.html || req.body;
  }

  if (!html || typeof html !== "string" || html.trim().length === 0) {
    return res.status(400).json({
      error: "Missing or empty HTML content",
      usage: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { html: "<your HTML string here>" },
        queryParams: {
          width: "viewport width in px (default: 800)",
          quality: "webp quality 1-100 (default: 80)",
          fullPage: "true/false (default: true)",
        },
      },
    });
  }

  // ── Options from query params ─────────────────────────────────────
  const viewportWidth = parseInt(req.query?.width, 10) || 800;
  const quality = Math.min(
    100,
    Math.max(1, parseInt(req.query?.quality, 10) || 80)
  );
  const fullPage = req.query?.fullPage !== "false";

  let browser = null;

  try {
    // ── Launch headless Chromium ───────────────────────────────────
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: {
        width: viewportWidth,
        height: 900,
        deviceScaleFactor: 2,
      },
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Block heavy external resources for speed
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (["media", "websocket", "manifest"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Set the HTML content
    await page.setContent(html, {
      waitUntil: ["load", "networkidle0"],
      timeout: 30000,
    });

    // Give images a moment to render
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );

    // ── Take full-page screenshot as WebP ─────────────────────────
    const screenshotBuffer = await page.screenshot({
      type: "webp",
      quality: quality,
      fullPage: fullPage,
    });

    // ── Return the image ──────────────────────────────────────────
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Length", screenshotBuffer.length);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(screenshotBuffer);
  } catch (err) {
    console.error("Screenshot error:", err);
    return res.status(500).json({
      error: "Failed to generate screenshot",
      message: err.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

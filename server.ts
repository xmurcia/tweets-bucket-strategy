import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const XTRACKER_API_URL = 'https://xtracker.polymarket.com/api';
  const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

  // Proxy for Polymarket API to avoid CORS issues
  app.get("/api/polymarket/events", async (req, res) => {
    try {
      const { query } = req.query;
      // Filtros para eventos: solo activos
      const params = new URLSearchParams({
        active: 'true',
        closed: 'false',
        limit: '50',
        archived: 'false',
        order: 'volume24hr',
        ascending: 'false'
      });
      
      const response = await fetch(`${GAMMA_API_URL}/events?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch from Polymarket');
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Proxy para obtener todos los contadores activos de un usuario
  app.get("/api/polymarket/active-counts/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const userRes = await fetch(`${XTRACKER_API_URL}/users/${userId}`);
      if (!userRes.ok) throw new Error('Failed to fetch from XTracker');
      const userData = await userRes.json();
      // Revertimos al formato que funcionaba antes
      res.json({ data: userData.data || [] });
    } catch (error) {
      console.error('Active counts error:', error);
      res.status(500).json({ error: 'Failed to fetch active counts' });
    }
  });

  // Proxy para obtener el contador de tweets (Trackings)
  app.get("/api/polymarket/trackings/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const response = await fetch(`${XTRACKER_API_URL}/trackings/${id}?includeStats=true`);
      if (!response.ok) throw new Error('Failed to fetch tracking stats from XTracker');
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Tracking proxy error:', error);
      res.status(500).json({ error: 'Failed to fetch tracking' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

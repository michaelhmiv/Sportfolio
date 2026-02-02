/**
 * Player Routes with Aggressive Caching
 * 
 * Reduces DB egress by caching player listings and details
 */

import { Express, Request, Response } from 'express';
import { storage } from '../storage';
import { getCachedActivePlayers, getCachedPlayer, getCachedPlayersByIds } from '../cache-enhanced';
import { invalidatePlayerCaches } from '../cache-enhanced';

export function setupPlayerRoutes(app: Express) {
  // GET /api/players - List all active players (CACHED)
  app.get('/api/players', async (_req, res) => {
    try {
      const players = await getCachedActivePlayers();
      res.json(players);
    } catch (error) {
      console.error('Error fetching players:', error);
      res.status(500).json({ error: 'Failed to fetch players' });
    }
  });

  // GET /api/players/:id - Get player details (CACHED)
  app.get('/api/players/:id', async (req, res) => {
    try {
      const player = await getCachedPlayer(req.params.id);
      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }
      res.json(player);
    } catch (error) {
      console.error('Error fetching player:', error);
      res.status(500).json({ error: 'Failed to fetch player' });
    }
  });

  // POST /api/players/batch - Get multiple players by IDs (CACHED)
  // FIXES N+1 QUERY: Use this instead of looping with getPlayer
  app.post('/api/players/batch', async (req, res) => {
    try {
      const { playerIds } = req.body;
      if (!Array.isArray(playerIds)) {
        return res.status(400).json({ error: 'playerIds must be an array' });
      }
      
      // Use cached batch fetch instead of N+1 queries
      const players = await getCachedPlayersByIds(playerIds);
      res.json(players);
    } catch (error) {
      console.error('Error fetching players batch:', error);
      res.status(500).json({ error: 'Failed to fetch players' });
    }
  });
}

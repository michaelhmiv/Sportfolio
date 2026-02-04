/**
 * News Fetch Job (v2 - Context-Aware Multi-Story)
 * 
 * Runs hourly to fetch breaking sports news using Perplexity AI (Sonar Pro).
 * Features:
 * - Feeds last 7 days of headlines as context to avoid duplicates
 * - Supports multiple stories per query (up to 3)
 * - AI-powered deduplication and follow-up detection
 * - Cleans up entries older than 7 days
 */

import { db } from "../db";
import { newsFeed } from "@shared/schema";
import { perplexityService } from "../services/perplexity";
import { createHash } from "crypto";
import { desc, lt, sql } from "drizzle-orm";
import type { ProgressCallback } from "../lib/admin-stream";

interface NewsResult {
    success: boolean;
    storiesProcessed: number;
    stories: Array<{
        headline: string;
        briefing: string;
        sport: string;
        type: 'NEW' | 'UPDATE';
    }>;
    error?: string;
}

interface ParsedStory {
    type: 'NEW' | 'UPDATE';
    headline: string;
    briefing: string;
    sport: 'NBA' | 'NFL' | 'MLB';
    sourceUrl: string | null;
}

/**
 * Generate a content hash for deduplication (backup check)
 */
function generateContentHash(headline: string): string {
    return createHash('sha256').update(headline.toLowerCase().trim()).digest('hex');
}

/**
 * Check if a story is likely fresh (not retrospective/old news)
 * Rejects stories that mention past events, "looking back", etc.
 */
function isStoryFresh(headline: string, briefing: string): boolean {
    const combinedText = (headline + ' ' + briefing).toLowerCase();
    
    // Red flags that indicate old/retrospective content
    const staleIndicators = [
        'last season',
        'yesterday',
        'last week',
        'last month',
        'remember when',
        'looking back',
        'retrospective',
        'on this day',
        'anniversary',
        'years ago',
        'ago today',
        'since last',
        'earlier this season',
        'previously announced',
        'already been',
        'was announced'
    ];
    
    for (const indicator of staleIndicators) {
        if (combinedText.includes(indicator)) {
            console.log(`[News] Rejected stale content (contains "${indicator}"): "${headline.substring(0, 50)}..."`);
            return false;
        }
    }
    
    return true;
}

/**
 * Get recent headlines from the database to use as context
 */
async function getRecentHeadlines(): Promise<string[]> {
    const recentNews = await db
        .select({ headline: newsFeed.headline, createdAt: newsFeed.createdAt })
        .from(newsFeed)
        .orderBy(desc(newsFeed.createdAt))
        .limit(30); // Last 30 headlines should be plenty of context

    return recentNews.map(n => {
        const daysAgo = Math.floor((Date.now() - new Date(n.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        const timeLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
        return `- "${n.headline}" (${timeLabel})`;
    });
}

/**
 * Build the context-aware prompt with recent news history
 */
function buildPrompt(recentHeadlines: string[]): string {
    const headlinesContext = recentHeadlines.length > 0
        ? `STORIES WE'VE ALREADY REPORTED (do not repeat unless there's a significant update):\n${recentHeadlines.join('\n')}\n\n`
        : 'We have no recent news history yet.\n\n';

    return `You are a breaking news reporter for NBA, NFL, and MLB sports.

${headlinesContext}INSTRUCTIONS:
1. Search for NEWS from the LAST 12 HOURS - include coaching hires, signings, trades, injuries, and roster moves
2. Report up to 3 stories maximum (any significant team/personnel news qualifies)
3. CRITICAL: Report NEW announcements, coaching hires, signings, trades, injuries from the last 12 hours
4. CRITICAL: Do NOT report retrospective articles, analysis pieces, or "looking back" content
5. CRITICAL: Do NOT report on any player who appears in the stories above, even with a different angle
6. CRITICAL: Always use full player names (e.g., "LeBron James" instead of "LeBron") to ensure proper auto-linking
7. Skip any story about players/teams we've already covered
8. Prioritize: coaching hires, signings, trades, breaking injuries, roster moves

FRESHNESS RULES:
- Include news from the last 12 hours (since ${new Date().toISOString()})
- NO "remember when" or "looking back at last season" content
- Coaching hires and signings ARE newsworthy even if announced a few hours ago
- If the event happened yesterday or earlier AND it's not a new development, SKIP IT

OUTPUT FORMAT (use this EXACT structure for each story):
---STORY---
CITATIONS: [1], [2] (list citation numbers used in this story)
TYPE: NEW
HEADLINE: [Concise headline, max 80 characters]
BRIEFING: [1-2 sentence summary for sports traders, focus on impact]
SPORT: [NBA, NFL, or MLB]
---END---

IMPORTANT: Include the CITATIONS field showing which sources ([1], [2], etc.) this story used.
IMPORTANT: If there is no significant BREAKING news from the last 12 hours, respond with exactly: NO_NEWS`;
}

/**
 * Validate that URL matches headline content
 */
function validateUrlMatchesHeadline(headline: string, url: string | null): boolean {
    if (!url) return false;
    
    const urlLower = url.toLowerCase();
    const headlineLower = headline.toLowerCase();
    
    // Extract key words from headline (3+ chars)
    const headlineWords = headlineLower.match(/\b[a-z]{3,}\b/g) || [];
    
    // Count matches
    const matches = headlineWords.filter(word => 
        !['the', 'and', 'for', 'with', 'from', 'coach', 'head', 'head coach', 'general', 'manager'].includes(word) &&
        urlLower.includes(word)
    ).length;
    
    // Require at least 1 keyword match OR proper name match
    if (matches >= 1) return true;
    
    // Check for proper names (capitalized words in headline)
    const properNames = headline.match(/\b[A-Z][a-z]+\b/g) || [];
    for (const name of properNames) {
        if (urlLower.includes(name.toLowerCase())) return true;
    }
    
    return false;
}

/**
 * Parse the multi-story response from Perplexity
 * FIXED: Now accepts citations array and maps citation numbers to URLs
 */
function parseMultiStoryResponse(content: string, citations?: string[]): ParsedStory[] {
    const stories: ParsedStory[] = [];

    // Handle NO_NEWS response
    if (content.trim() === 'NO_NEWS' || content.includes('NO_NEWS')) {
        console.log('[News] Perplexity returned NO_NEWS - no significant news at this time');
        return [];
    }

    // Split by story delimiter
    const storyBlocks = content.split('---STORY---').slice(1); // Skip first empty element

    for (const block of storyBlocks) {
        try {
            const endIdx = block.indexOf('---END---');
            const storyContent = endIdx > 0 ? block.substring(0, endIdx) : block;

            // Parse each field including CITATIONS
            const citationsMatch = storyContent.match(/CITATIONS:\s*(.+?)(?=\n|TYPE:)/is);
            const typeMatch = storyContent.match(/TYPE:\s*(NEW|UPDATE)/i);
            const headlineMatch = storyContent.match(/HEADLINE:\s*(.+?)(?=\n|BRIEFING:)/is);
            const briefingMatch = storyContent.match(/BRIEFING:\s*(.+?)(?=\n|SPORT:)/is);
            const sportMatch = storyContent.match(/SPORT:\s*(NBA|NFL|MLB)/i);

            if (headlineMatch && briefingMatch) {
                // Extract citation numbers from CITATIONS field
                const citationNumbers: number[] = [];
                if (citationsMatch) {
                    const matches = citationsMatch[1].match(/\[(\d+)\]/g);
                    if (matches) {
                        matches.forEach(m => {
                            const num = parseInt(m.replace(/[\[\]]/g, ''));
                            if (!isNaN(num) && num > 0) citationNumbers.push(num);
                        });
                    }
                }

                // Map citation [1] to citations[0], [2] to citations[1], etc.
                let sourceUrl: string | null = null;
                if (citationNumbers.length > 0 && citations && citations.length > 0) {
                    const citationIndex = citationNumbers[0] - 1;
                    if (citationIndex >= 0 && citationIndex < citations.length) {
                        sourceUrl = citations[citationIndex];
                    }
                }

                // Clean up text but keep it natural
                const cleanText = (text: string): string => {
                    return text.replace(/\s+/g, ' ').trim();
                };

                const headline = cleanText(headlineMatch[1]);
                
                // Validate URL matches headline - if not, don't use the URL
                if (sourceUrl && !validateUrlMatchesHeadline(headline, sourceUrl)) {
                    console.warn(`[News] URL mismatch for: "${headline.substring(0, 50)}..." - URL: ${sourceUrl.substring(0, 60)}...`);
                    console.warn('[News] Skipping story due to URL/headline mismatch');
                    continue; // Skip this story
                }

                stories.push({
                    type: (typeMatch?.[1]?.toUpperCase() as 'NEW' | 'UPDATE') || 'NEW',
                    headline: headline,
                    briefing: cleanText(briefingMatch[1]),
                    sport: (sportMatch?.[1]?.toUpperCase() as 'NBA' | 'NFL' | 'MLB') || 'NBA',
                    sourceUrl,
                });
            }
        } catch (e) {
            console.warn('[News] Failed to parse story block:', block.substring(0, 100));
        }
    }

    return stories;
}

/**
 * Fetch news from Perplexity and store in database
 */
export async function fetchNews(progressCallback?: ProgressCallback): Promise<NewsResult> {
    try {
        progressCallback?.({
            message: 'Checking Perplexity service status...', 
            type: 'info',
            timestamp: new Date().toISOString()
        });

        if (!perplexityService.isReady()) {
            const error = 'Perplexity service not configured. Skipping news fetch.';
            console.log(`[News] ${error}`);
            progressCallback?.({
                message: error,
                type: 'warning',
                timestamp: new Date().toISOString()
            });
            return { success: false, storiesProcessed: 0, stories: [], error };
        }

        // Get recent headlines for context
        progressCallback?.({
            message: 'Loading recent news for context...', 
            type: 'info',
            timestamp: new Date().toISOString()
        });
        const recentHeadlines = await getRecentHeadlines();
        console.log(`[News] Loaded ${recentHeadlines.length} recent headlines for context`);
        if (recentHeadlines.length > 0) {
            console.log('[News] Headlines being sent as context:');
            recentHeadlines.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
        }

        // Build context-aware prompt
        const prompt = buildPrompt(recentHeadlines);
        console.log(`[News] Full prompt length: ${prompt.length} characters`);

        progressCallback?.({
            message: 'Fetching breaking news from Perplexity...', 
            type: 'info',
            timestamp: new Date().toISOString()
        });
        console.log('[News] Fetching breaking news with context...');

        // Call Perplexity
        const response = await perplexityService.fetchBreakingNews(prompt);

        if (!response.success || !response.content) {
            const error = response.error || 'No content received';
            console.error('[News] Perplexity failed:', error);
            progressCallback?.({
                message: `Failed to fetch news: ${error}`, 
                type: 'error',
                timestamp: new Date().toISOString()
            });
            return { success: false, storiesProcessed: 0, stories: [], error };
        }

        console.log('[News] Raw response:', response.content.substring(0, 500));

        // Parse multi-story response
        const parsedStories = parseMultiStoryResponse(response.content, response.citations);

        if (parsedStories.length === 0) {
            console.log('[News] No significant news to report');
            progressCallback?.({
                message: 'No significant news at this time', 
                type: 'info',
                timestamp: new Date().toISOString()
            });
            return { success: true, storiesProcessed: 0, stories: [] };
        }

        console.log(`[News] Parsed ${parsedStories.length} stories from response`);

        // Process each story
        const processedStories: NewsResult['stories'] = [];

        for (const story of parsedStories) {
            // Check if story is fresh (not retrospective/old news)
            if (!isStoryFresh(story.headline, story.briefing)) {
                console.log(`[News] Skipping stale content: "${story.headline.substring(0, 50)}..."`);
                continue;
            }

            // Generate hash for backup deduplication check
            const contentHash = generateContentHash(story.headline);

            // Check if this exact headline already exists (backup check)
            const existing = await db
                .select()
                .from(newsFeed)
                .where(sql`${newsFeed.contentHash} = ${contentHash}`)
                .limit(1);

            if (existing.length > 0) {
                console.log(`[News] Skipping duplicate: "${story.headline.substring(0, 50)}..."`);
                continue;
            }

            // Insert new story
            await db.insert(newsFeed).values({
                headline: story.headline,
                briefing: story.briefing,
                sourceUrl: story.sourceUrl,
                contentHash,
                sport: story.sport,
            });

            console.log(`[News] Stored ${story.type} ${story.sport} news: "${story.headline}"`);
            progressCallback?.({
                message: `Stored: "${story.headline.substring(0, 40)}..."`, 
                type: 'complete',
                timestamp: new Date().toISOString()
            });
        }

        // Cleanup old entries (older than 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const deleted = await db
            .delete(newsFeed)
            .where(lt(newsFeed.createdAt, sevenDaysAgo));

        if (deleted.rowCount && deleted.rowCount > 0) {
            console.log(`[News] Cleaned up ${deleted.rowCount} old news entries`);
        }

        return {
            success: true,
            storiesProcessed: processedStories.length,
            stories: processedStories,
        };
    } catch (error: any) {
        console.error('[News] Fetch failed:', error.message);
        progressCallback?.({
            message: `Error: ${error.message}`, 
            type: 'error',
            timestamp: new Date().toISOString()
        });
        return { success: false, storiesProcessed: 0, stories: [], error: error.message };
    }
}

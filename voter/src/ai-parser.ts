import logger from './logger';

// Simple in-memory cache
interface CacheEntry {
  response: string;
  timestamp: number;
}

// Cache with TTL (time-to-live) of 1 hour by default
const responseCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Generate a cache key from directive and proposal
 */
function generateCacheKey(directive: string, proposal: string): string {
  return `${directive.trim()}:${proposal.trim()}`;
}

/**
 * Fetch OpenAI response with caching
 * @param directive The system prompt
 * @param proposal The user prompt
 * @param skipCache Optional flag to bypass cache
 * @returns The AI response
 */
export async function fetchOpenAIResponse(
  directive: string, 
  proposal: string, 
  skipCache: boolean = false
): Promise<string> {
  const cacheKey = generateCacheKey(directive, proposal);
  const now = Date.now();
  
  // Check cache first unless skipCache is true
  if (!skipCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      logger.info('Using cached OpenAI response');
      return cached.response;
    }
  }
  
  // Not in cache or cache expired, fetch from API
  const OpenAI = (await import('openai')).OpenAI;
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    logger.info('Fetching OpenAI directly');
    logger.info(`Directive: ${directive}`);
    
    // Only log first 3 lines of proposal
    const proposalLines = proposal.split('\n');
    const previewLines = proposalLines.slice(0, 3).join('\n');
    logger.info(`Proposal (first 3 lines): ${previewLines}`);
    
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4.1',
      messages: [
        { role: 'system', content: directive },
        { role: 'user', content: proposal },
      ],
    });

    logger.info(`OpenAI full response: ${JSON.stringify(response, null, 2)}`);
    
    const responseText = response.choices[0].message.content || '';
    
    // Store in cache
    responseCache.set(cacheKey, {
      response: responseText,
      timestamp: now
    });
    
    return responseText;
  } catch (error: any) {
    logger.error('OpenAI Error:', error);
    throw error;
  }
}

/**
 * Clear all cached responses
 */
export function clearResponseCache(): void {
  responseCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number, entries: Array<{ key: string, age: number }> } {
  const now = Date.now();
  const entries = Array.from(responseCache.entries()).map(([key, entry]) => ({
    key,
    age: Math.round((now - entry.timestamp) / 1000) // age in seconds
  }));
  
  return {
    size: responseCache.size,
    entries
  };
}
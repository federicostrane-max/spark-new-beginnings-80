import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestRequest {
  documentId?: string;
  strategies?: ('full_ocr' | 'web_search' | 'content_inference')[];
}

interface StrategyResult {
  strategy: string;
  success: boolean;
  title?: string;
  authors?: string[];
  confidence?: 'high' | 'medium' | 'low';
  verified?: boolean;
  executionTimeMs: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    const { documentId, strategies = ['full_ocr', 'web_search', 'content_inference'] }: TestRequest = await req.json();
    
    console.log(`[test-aggressive] Starting test with strategies:`, strategies);
    
    // Get target document (LOW or MEDIUM confidence)
    let targetDoc: any;
    
    if (documentId) {
      const { data } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('id', documentId)
        .single();
      targetDoc = data;
    } else {
      // Auto-select first LOW or MEDIUM confidence doc
      const { data } = await supabase
        .from('knowledge_documents')
        .select('*')
        .or('metadata_confidence.eq.low,metadata_confidence.eq.medium')
        .limit(1)
        .single();
      targetDoc = data;
    }
    
    if (!targetDoc) {
      return new Response(
        JSON.stringify({ error: 'No document found to test' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[test-aggressive] Testing on document: ${targetDoc.file_name} (confidence: ${targetDoc.metadata_confidence})`);
    
    const results: StrategyResult[] = [];
    let bestResult: StrategyResult | null = null;
    
    // Strategy 1: Full PDF OCR
    if (strategies.includes('full_ocr')) {
      const startTime = Date.now();
      try {
        console.log('[test-aggressive] Strategy 1: Full PDF OCR');
        
        const { data: signedUrlData } = await supabase.storage
          .from('knowledge-pdfs')
          .createSignedUrl(targetDoc.file_path, 3600);
        
        if (signedUrlData?.signedUrl) {
          const { data: ocrData, error: ocrError } = await supabase.functions.invoke('ocr-image', {
            body: { 
              imageUrl: signedUrlData.signedUrl, 
              fileName: targetDoc.file_name,
              maxPages: 999 // Analyze ALL pages
            }
          });
          
          if (!ocrError && ocrData?.extractedText) {
            // Extract metadata using AI from full text
            const metadata = await extractMetadataFromText(ocrData.extractedText, lovableApiKey);
            
            const result: StrategyResult = {
              strategy: 'full_ocr',
              success: true,
              title: metadata.title,
              authors: metadata.authors,
              confidence: metadata.confidence,
              executionTimeMs: Date.now() - startTime
            };
            
            results.push(result);
            console.log(`[test-aggressive] Full OCR result: ${metadata.title} (${metadata.confidence})`);
            
            if (!bestResult || isResultBetter(result, bestResult)) {
              bestResult = result;
            }
          } else {
            results.push({
              strategy: 'full_ocr',
              success: false,
              executionTimeMs: Date.now() - startTime,
              error: ocrError?.message || 'OCR failed'
            });
          }
        }
      } catch (e) {
        results.push({
          strategy: 'full_ocr',
          success: false,
          executionTimeMs: Date.now() - startTime,
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      }
    }
    
    // Strategy 2: Filename Web Search
    if (strategies.includes('web_search')) {
      const startTime = Date.now();
      try {
        console.log('[test-aggressive] Strategy 2: Filename Web Search');
        
        // Clean filename for search
        const cleanQuery = targetDoc.file_name
          .replace(/\.pdf$/i, '')
          .replace(/[-_]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        console.log(`[test-aggressive] Searching for: "${cleanQuery}"`);
        
        // Search on web
        const { data: searchData, error: searchError } = await supabase.functions.invoke('web-search', {
          body: { 
            query: cleanQuery + ' academic paper pdf',
            numResults: 5,
            scrapeResults: false
          }
        });
        
        if (!searchError && searchData?.results?.length > 0) {
          // Try to extract metadata from search results
          const topResult = searchData.results[0];
          const inferredTitle = topResult.title?.replace(' - Google Scholar', '').replace(' - arXiv', '').trim();
          
          const result: StrategyResult = {
            strategy: 'web_search',
            success: true,
            title: inferredTitle,
            authors: [],
            confidence: 'medium',
            verified: true,
            executionTimeMs: Date.now() - startTime
          };
          
          results.push(result);
          console.log(`[test-aggressive] Web search result: ${inferredTitle}`);
          
          if (!bestResult || isResultBetter(result, bestResult)) {
            bestResult = result;
          }
        } else {
          results.push({
            strategy: 'web_search',
            success: false,
            executionTimeMs: Date.now() - startTime,
            error: searchError?.message || 'No results found'
          });
        }
      } catch (e) {
        results.push({
          strategy: 'web_search',
          success: false,
          executionTimeMs: Date.now() - startTime,
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      }
    }
    
    // Strategy 3: Content-Based Inference
    if (strategies.includes('content_inference')) {
      const startTime = Date.now();
      try {
        console.log('[test-aggressive] Strategy 3: Content-Based Inference');
        
        // Get all chunks for this document
        const { data: chunks } = await supabase
          .from('agent_knowledge')
          .select('content')
          .eq('pool_document_id', targetDoc.id)
          .limit(50);
        
        if (chunks && chunks.length > 0) {
          const combinedContent = chunks.map(c => c.content).join('\n\n---\n\n');
          
          // Use AI to infer title from content
          const prompt = `Based on these document excerpts, infer the most likely academic paper or book title.

Document excerpts:
${combinedContent.slice(0, 5000)}

Look for:
- Recurring technical terms and concepts
- Chapter or section structure patterns
- Mathematical formulas and their context
- Domain-specific vocabulary
- Any explicit title mentions

Return a JSON object with this format:
{
  "title": "The inferred title (5-200 characters)",
  "reasoning": "Brief explanation of why this title was chosen",
  "confidence": "high" or "medium" or "low"
}`;
          
          const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            })
          });
          
          const data = await response.json();
          const content = data.choices[0].message.content.replace(/```json|```/g, '').trim();
          const inference = JSON.parse(content);
          
          const result: StrategyResult = {
            strategy: 'content_inference',
            success: true,
            title: inference.title,
            authors: [],
            confidence: inference.confidence || 'medium',
            executionTimeMs: Date.now() - startTime
          };
          
          results.push(result);
          console.log(`[test-aggressive] Content inference result: ${inference.title} (${inference.confidence})`);
          console.log(`[test-aggressive] Reasoning: ${inference.reasoning}`);
          
          if (!bestResult || isResultBetter(result, bestResult)) {
            bestResult = result;
          }
        } else {
          results.push({
            strategy: 'content_inference',
            success: false,
            executionTimeMs: Date.now() - startTime,
            error: 'No chunks found'
          });
        }
      } catch (e) {
        results.push({
          strategy: 'content_inference',
          success: false,
          executionTimeMs: Date.now() - startTime,
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      }
    }
    
    // Calculate summary
    const totalTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0);
    const successCount = results.filter(r => r.success).length;
    
    const response = {
      document: {
        id: targetDoc.id,
        fileName: targetDoc.file_name,
        currentTitle: targetDoc.extracted_title,
        currentConfidence: targetDoc.metadata_confidence,
        currentVerified: targetDoc.metadata_verified_online
      },
      results,
      bestResult,
      summary: {
        strategiesTested: strategies.length,
        successfulStrategies: successCount,
        totalExecutionTimeMs: totalTime,
        averageTimePerStrategy: Math.round(totalTime / strategies.length),
        improvement: bestResult ? {
          newTitle: bestResult.title,
          newConfidence: bestResult.confidence,
          confidenceUpgrade: getConfidenceUpgrade(targetDoc.metadata_confidence, bestResult.confidence)
        } : null
      }
    };
    
    console.log(`[test-aggressive] Test complete. ${successCount}/${strategies.length} strategies succeeded`);
    if (bestResult) {
      console.log(`[test-aggressive] Best strategy: ${bestResult.strategy} -> "${bestResult.title}" (${bestResult.confidence})`);
    }
    
    return new Response(
      JSON.stringify(response, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[test-aggressive] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function extractMetadataFromText(text: string, apiKey: string): Promise<{
  title: string;
  authors: string[];
  confidence: 'high' | 'medium' | 'low';
}> {
  const prompt = `Extract the academic paper or book title and authors from this text.

Rules:
- Title must be 5-200 characters
- Look for "Title:", "By:", first bold text, or header patterns
- Avoid generic phrases like "Abstract", "Introduction", "Chapter"
- Return high confidence only if clearly identifiable

Text (first 5000 chars):
${text.slice(0, 5000)}

Return JSON:
{
  "title": "...",
  "authors": ["..."],
  "confidence": "high" | "medium" | "low"
}`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  const content = data.choices[0].message.content.replace(/```json|```/g, '').trim();
  const result = JSON.parse(content);
  
  return {
    title: result.title || 'Unknown',
    authors: result.authors || [],
    confidence: result.confidence || 'low'
  };
}

function isResultBetter(result: StrategyResult, current: StrategyResult): boolean {
  if (!result.success) return false;
  if (!current.success) return true;
  
  const confidenceOrder = { 'high': 3, 'medium': 2, 'low': 1 };
  const resultScore = confidenceOrder[result.confidence || 'low'];
  const currentScore = confidenceOrder[current.confidence || 'low'];
  
  if (resultScore > currentScore) return true;
  if (resultScore < currentScore) return false;
  
  // Same confidence, prefer verified
  if (result.verified && !current.verified) return true;
  
  return false;
}

function getConfidenceUpgrade(oldConf: string | null, newConf: string | undefined): string {
  if (!oldConf || !newConf) return 'none';
  
  const order = { 'low': 1, 'medium': 2, 'high': 3 };
  const oldScore = order[oldConf as keyof typeof order] || 0;
  const newScore = order[newConf as keyof typeof order] || 0;
  
  if (newScore > oldScore) return `upgraded from ${oldConf} to ${newConf}`;
  if (newScore === oldScore) return 'no change';
  return `downgraded from ${oldConf} to ${newConf}`;
}

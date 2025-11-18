import { createClient } from 'npm:@supabase/supabase-js@2';

interface MetadataResult {
  title: string | null;
  authors: string[] | null;
  source: 'pdf' | 'chunks';
  success: boolean;
  confidence?: 'high' | 'medium' | 'low';
  extractionMethod?: 'vision' | 'text' | 'chunks' | 'filename';
  verifiedOnline?: boolean;
  verifiedSource?: string;
}

export async function extractMetadataWithFallback(
  supabase: any,
  documentId: string,
  filePath?: string,
  fileName?: string,
  enableWebValidation: boolean = true
): Promise<MetadataResult> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) throw new Error('LOVABLE_API_KEY not configured');

  console.log(`[metadata] Starting for ${documentId}`);

  // Try Vision
  try {
    const { data, error } = await supabase.functions.invoke('extract-metadata-vision', {
      body: { documentId, filePath, fileName }
    });
    if (!error && data?.success && data.confidence === 'high') {
      console.log('[metadata] ✅ Vision high confidence');
      return { ...data, extractionMethod: 'vision' };
    }
  } catch (e) { console.log('[metadata] Vision failed'); }

  // Get text
  let text = '';
  let source: 'pdf' | 'chunks' = 'pdf';

  try {
    const { data, error } = await supabase.functions.invoke('extract-pdf-text', {
      body: { documentId, filePath }
    });
    if (!error && data?.text) text = data.text;
    else throw new Error('PDF failed');
  } catch {
    const { data } = await supabase
      .from('agent_knowledge')
      .select('content')
      .eq('pool_document_id', documentId)
      .limit(20); // Increased from 5 to 20 for aggressive extraction
    if (data?.length) {
      text = data.map((c: any) => c.content).join('\n');
      source = 'chunks';
    }
  }

  if (!text) {
    const title = (fileName || 'unknown').replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
    return { title, authors: [], source: 'chunks', success: true, confidence: 'low', extractionMethod: 'filename', verifiedOnline: false };
  }

  // AI extraction
  try {
    // Enhanced prompt for better extraction with more context
    const maxChars = Math.min(text.length, 10000); // Increased from 3000 to 10000
    const prompt = `You are a precise metadata extractor for academic and technical documents. 

INSTRUCTIONS:
1. Extract the document's title and authors from the text below
2. Title should be 5-200 characters
3. Look for explicit markers like "Title:", "By:", author lists, or first prominent heading
4. If multiple potential titles exist, choose the most comprehensive one
5. For authors, extract full names (avoid abbreviations if possible)
6. Return HIGH confidence only if you find clear, unambiguous metadata
7. Return MEDIUM if metadata is inferred but reasonable
8. Return LOW if uncertain

TEXT:
${text.slice(0, maxChars)}

Return ONLY valid JSON: {"title":"...","authors":["..."],"confidence":"high|medium|low"}`;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    const data = await res.json();
    const content = data.choices[0].message.content.replace(/```json|```/g, '').trim();
    const meta = JSON.parse(content);

    let title = meta.title;
    let conf: 'high' | 'medium' | 'low' = meta.confidence || 'medium';
    let method: 'text' | 'chunks' | 'filename' = source === 'pdf' ? 'text' : 'chunks';

    const inv = [/^abstract:/i, /^intro/i, /^chapter\s+\d/i, /^\d+$/];
    const needsAggressiveFallback = !title || title === 'unknown' || title.length < 5 || inv.some(p => p.test(title)) || conf === 'low';
    
    // Aggressive fallback: if initial extraction is poor, try with more context
    if (needsAggressiveFallback && source === 'chunks') {
      console.log('[metadata] Initial extraction poor, trying aggressive strategy...');
      title = (fileName || 'unknown').replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
      conf = 'low';
      method = 'filename';
    } else if (needsAggressiveFallback) {
      title = (fileName || 'unknown').replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
      conf = 'low';
      method = 'filename';
    }

    let verified = false;
    let verSrc: string | undefined;

    if (enableWebValidation && title) {
      try {
        const { data } = await supabase.functions.invoke('validate-metadata-online', {
          body: { title, authors: meta.authors }
        });
        if (data?.verified) {
          verified = true;
          verSrc = data.source;
          if (conf === 'low') conf = 'medium';
        }
      } catch {}
    }

    return {
      title,
      authors: meta.authors || [],
      source,
      success: true,
      confidence: conf,
      extractionMethod: method,
      verifiedOnline: verified,
      verifiedSource: verSrc
    };

  } catch {
    const fb = (fileName || 'unknown').replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
    return { title: fb, authors: [], source, success: true, confidence: 'low' as const, extractionMethod: 'filename', verifiedOnline: false };
  }
}

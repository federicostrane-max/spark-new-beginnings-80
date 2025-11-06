/**
 * Error categorization helper for consistent error classification across edge functions
 */

export function categorizeError(error: any): string {
  const message = error.message?.toLowerCase() || '';
  
  // Timeout errors
  if (message.includes('timeout') || message.includes('deadline') || message.includes('timed out')) {
    return 'TIMEOUT';
  }
  
  // API errors
  if (message.includes('api') || message.includes('rate limit') || message.includes('429')) {
    return 'API_ERROR';
  }
  
  // LLM errors
  if (message.includes('model') || message.includes('completion') || message.includes('openai') || 
      message.includes('anthropic') || message.includes('gemini')) {
    return 'LLM_ERROR';
  }
  
  // Database errors
  if (message.includes('database') || message.includes('query') || message.includes('postgres') ||
      message.includes('supabase')) {
    return 'DATABASE_ERROR';
  }
  
  // Validation errors
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return 'VALIDATION_ERROR';
  }
  
  // Network errors
  if (message.includes('network') || message.includes('fetch') || message.includes('connection') ||
      message.includes('econnrefused')) {
    return 'NETWORK_ERROR';
  }
  
  // Storage errors
  if (message.includes('storage') || message.includes('bucket') || message.includes('upload')) {
    return 'STORAGE_ERROR';
  }
  
  // Authentication errors
  if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) {
    return 'AUTH_ERROR';
  }
  
  return 'UNKNOWN_ERROR';
}

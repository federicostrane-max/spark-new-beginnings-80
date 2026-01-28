/**
 * Claude Launcher Desktop App API
 *
 * Client library for interacting with the Claude Launcher Desktop App.
 */

export { 
  LauncherClient, 
  createLauncherClient, 
  getLauncherClient,
  configureLauncherClient,
} from './client';

export type {
  // Session types
  TerminalSession,
  SessionMetadata,
  ParsedMessage,
  SessionSearchResult,
  
  // Orchestration types
  OrchestrationStatus,
  OrchestrationEvent,
  OrchestrationEventType,
  
  // Webhook types
  WebhookConfig,
  WebhookEventType,
  
  // API Response types
  ApiDocsResponse,
  SearchResponse,
  SessionMessagesResponse,
  BulkMetadataResponse,
  RestartResponse,
  BroadcastResponse,
  SessionsListResponse,
  CreateSessionResponse,
  SendMessageResponse,
  WebhooksListResponse,
  HealthCheckResponse,
  TestWebhookResponse,
  AnswerQuestionResponse,
  GetSessionResponse,
  UpdateWebhookResponse,
} from './types';

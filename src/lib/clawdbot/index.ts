/**
 * Clawdbot Client Library
 *
 * Browser automation client for Clawdbot Service.
 *
 * @example
 * // Via Tool Server proxy (recommended)
 * import { createClawdbotClient } from '@/lib/clawdbot';
 * const client = createClawdbotClient(toolServerUrl, securityToken);
 * const task = await client.navigate('https://example.com');
 *
 * @example
 * // With React hook
 * import { useClawdbotAutomation } from '@/hooks/useClawdbotAutomation';
 * const { navigate, click, type, messages, isRunning } = useClawdbotAutomation({
 *   toolServerUrl,
 *   securityToken
 * });
 */

export { ClawdbotClient, createClawdbotClient, createDirectClawdbotClient } from './client';
export * from './types';

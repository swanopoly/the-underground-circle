import {
  detectSmartRoute,
  type AgenticCodingSurface,
  type SmartRoutingResult,
} from './agenticCodingProfile';
import {
  extractMessageEntities,
  type MessageEntities,
} from './messageEntityExtractor';

export type MessageRoutingAnalysis = {
  entities: MessageEntities;
  route: SmartRoutingResult;
};

export function analyzeMessageRouting(
  message: string,
  surface: AgenticCodingSurface,
  recentHistory?: string[],
): MessageRoutingAnalysis {
  const entities = extractMessageEntities(message);
  const route = detectSmartRoute(message, surface, recentHistory, entities);
  return { entities, route };
}

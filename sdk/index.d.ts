export interface AuditFinding {
  key: string;
  id?: string | null;
  name: string;
  category?: string | null;
  impact?: 'critical' | 'high' | 'medium' | 'low' | null;
  fix?: string | null;
  passed: boolean | null;
  file?: string | null;
  line?: number | null;
  sourceUrl?: string | null;
  confidence?: number | string | null;
}

export interface AuditAction {
  key: string;
  id?: string | null;
  name: string;
  impact?: 'critical' | 'high' | 'medium' | 'low' | null;
  category?: string | null;
  fix?: string | null;
  why?: string | null;
  sourceUrl?: string | null;
}

export interface AuditResult {
  platform: string;
  platformLabel: string;
  score: number;
  passed: number;
  failed: number;
  skipped: number;
  checkCount: number;
  results: AuditFinding[];
  quickWins: AuditAction[];
  topNextActions: AuditAction[];
  suggestedNextCommand?: string;
  /** Convenience alias for `passed` */
  passing: number;
  /** Convenience alias for `passed + failed` */
  total: number;
}

export interface HarmonyResult {
  harmonyScore: number;
  platformScores: Record<string, number | null>;
  platformResults: Record<string, AuditResult | null>;
  drift: {
    drifts: Array<Record<string, unknown>>;
    harmonyScore: number;
  };
  recommendations: Array<Record<string, unknown>>;
  activePlatforms: Array<Record<string, unknown>>;
  model: Record<string, unknown>;
  /** Convenience alias for `harmonyScore` */
  average: number;
}

export interface Check {
  platform: string;
  id: string | null;
  key: string;
  name: string | null;
  category: string | null;
  impact: string | null;
  rating: string | null;
  fix: string | null;
  sourceUrl: string | null;
  confidence: number | null;
  lastVerified?: string | null;
  template?: string | null;
  deprecated?: boolean;
}

export interface RoutingChoice {
  platform: string;
  confidence: number;
  reasoning: string;
}

export interface RoutingResult {
  recommended: RoutingChoice | null;
  alternatives: RoutingChoice[];
  taskType: string;
}

export interface SynergyResult {
  dir: string;
  activePlatforms: string[];
  platformAudits: Record<string, AuditResult>;
  compound: Record<string, unknown>;
  amplification: Record<string, unknown>;
  compensation: Record<string, unknown>;
  patterns: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  errors: Array<{ platform: string; message: string }>;
  report: string;
}

export declare function audit(dir: string, platform?: string): Promise<AuditResult>;
export declare function harmonyAudit(dir: string): Promise<HarmonyResult>;
export declare function synergyReport(dir: string): Promise<SynergyResult>;
export declare function detectPlatforms(dir: string): string[];
export declare function getCatalog(): Check[];
export declare function routeTask(description: string, platforms: string[]): RoutingResult;

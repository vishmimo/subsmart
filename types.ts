
export interface Subscription {
  id: string;
  name: string;
  amount: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly';
  category: 'Entertainment' | 'Productivity' | 'Fitness' | 'Cloud Storage' | 'Other';
  usageLevel: number; // 0 to 100
  nextBillingDate: string;
  icon: string;
  isLinked?: boolean;
  lastSyncedUsage?: string;
  efficiencyScore?: number; // 0 to 100 calculated by (usage / cost factor)
}

export interface Recommendation {
  id: string;
  subName: string;
  action: 'Keep' | 'Cancel' | 'Downgrade' | 'Review';
  reasoning: string;
  potentialSaving: number;
  confidence: number; // 0 to 1
}

export interface UsageData {
  name: string;
  usage: number;
  cost: number;
}

export interface LaunchChecklist {
  accountsLinked: boolean;
  aiAnalyzed: boolean;
  cloudSynced: boolean;
  usageTracked: boolean;
}

export interface FinancialHealth {
  score: number;
  status: 'Critical' | 'Sub-optimal' | 'Good' | 'Excellent';
  summary: string;
}

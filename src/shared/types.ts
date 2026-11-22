import { z } from 'zod';

export type AssetType = 'stock' | 'etf' | 'crypto' | 'cash';

export interface ActualBudget {
  id?: string;
  cloudFileId: string;
  groupId: string;
  name: string;
  state?: string;
}

export interface ActualAccount {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  account_group_id?: string | null;
  clearedBalance?: number;
  unclearedBalance?: number;
  workingBalance?: number;
}

export interface ActualCategory {
  id: string;
  name: string;
  group_id: string;
  is_income?: boolean;
  hidden?: boolean;
}

export interface ActualCategoryGroup {
  id: string;
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  categories?: ActualCategory[];
}

export interface ActualPayee {
  id: string;
  name: string;
  category?: string | null;
  transfer_acct?: string | null;
}

export interface ActualTransaction {
  id: string;
  account: string;
  date: string;
  amount: number; // minor units (cents)
  payee?: string | null;
  payee_name?: string;
  imported_payee?: string | null;
  category?: string | null;
  notes?: string | null;
  imported_id?: string | null;
  cleared?: boolean;
  transfer_id?: string | null;
  schedule?: string | null;
}

export interface RecurConfig {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  start: string;
  endMode: 'never' | 'after_n_occurrences' | 'on_date';
  endOccurrences?: number;
  endDate?: string;
  skipWeekend?: boolean;
  weekendSolveMode?: 'before' | 'after';
}

export interface ActualSchedule {
  id: string;
  name?: string;
  rule?: string;
  next_date?: string;
  completed?: boolean;
  posts_transaction?: boolean;
  payee?: string | null;
  account?: string | null;
  amount?: number | { num1: number; num2: number };
  amountOp?: 'is' | 'isapprox' | 'isbetween';
  date?: string | RecurConfig;
}

export interface EnrichedSchedule extends ActualSchedule {
  accountName: string | null;
  payeeName: string | null;
  amountCents: number;
  recurrenceLabel: string;
  daysUntilNext: number | null;
  status: 'overdue' | 'due_soon' | 'upcoming' | 'completed';
  monthlyEquivalentCents: number;
}

export interface HoldingRecord {
  id: string;
  symbol: string;
  name: string;
  asset_type: AssetType;
  provider_id: string;
  quantity: number;
  avg_cost: number;
  currency: string;
  actual_account_id: string | null;
  notes: string | null;
  updated_at: string;
}

export interface EnrichedHolding extends HoldingRecord {
  price: number | null;
  priceCurrency: string;
  change24hPct: number | null;
  fxRateToBase: number;
  marketValueNative: number | null;
  marketValueBase: number | null;
  costBasisBase: number;
  unrealizedPnlBase: number | null;
  unrealizedPnlPct: number | null;
  dayChangeBase: number | null;
  fetchedAt: string | null;
  stale: boolean;
}

export interface PortfolioResponse {
  baseCurrency: string;
  holdings: EnrichedHolding[];
  rsuGrants: EnrichedRsuGrant[];
  rsuSummary: RsuSummary;
  totals: {
    marketValueBase: number;
    costBasisBase: number;
    unrealizedPnlBase: number;
    unrealizedPnlPct: number;
    dayChangeBase: number;
    dayChangePct: number;
    byType: {
      stock: number;
      etf: number;
      crypto: number;
      rsu: number;
      cash: number;
    };
  };
  fxRates: Record<string, number>;
  refreshedAt: string;
}

// --- RSUs & Vesting ---

export type RsuTrancheStatus = 'scheduled' | 'vested' | 'sold' | 'forfeited';
export type RsuEffectiveStatus = 'unvested' | 'vested' | 'sold' | 'forfeited';

export interface RsuTrancheRecord {
  id: string;
  grant_id: string;
  vest_date: string; // YYYY-MM-DD
  units: number;
  status: RsuTrancheStatus;
  vested_price: number | null;
  withheld_units: number;
  notes: string | null;
}

export interface EnrichedRsuTranche extends RsuTrancheRecord {
  effectiveStatus: RsuEffectiveStatus;
  netUnits: number;
  daysUntilVest: number;
  grossValueNative: number | null;
  grossValueBase: number | null;
  netValueNative: number | null;
  netValueBase: number | null;
  costBasisBase: number;
  unrealizedPnlBase: number | null;
}

export interface RsuGrantRecord {
  id: string;
  symbol: string;
  name: string;
  provider_id: string;
  grant_name: string;
  grant_date: string; // YYYY-MM-DD
  grant_price: number;
  currency: string;
  tax_withhold_pct: number;
  include_in_total: boolean;
  actual_account_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrichedRsuGrant extends RsuGrantRecord {
  price: number | null;
  priceCurrency: string;
  change24hPct: number | null;
  fxRateToBase: number;
  fetchedAt: string | null;
  stale: boolean;
  totalUnits: number;
  vestedUnits: number;
  heldUnits: number;
  soldUnits: number;
  unvestedUnits: number;
  unvestedNetUnits: number;
  forfeitedUnits: number;
  vestedPct: number;
  heldValueNative: number | null;
  heldValueBase: number | null;
  costBasisBase: number;
  unrealizedPnlBase: number | null;
  unrealizedPnlPct: number | null;
  unvestedGrossValueBase: number | null;
  unvestedNetValueBase: number | null;
  dayChangeBase: number | null;
  nextVest: {
    trancheId: string;
    vestDate: string;
    units: number;
    netUnits: number;
    netValueBase: number | null;
    daysUntilVest: number;
  } | null;
  tranches: EnrichedRsuTranche[];
}

export interface UpcomingRsuVest {
  grantId: string;
  trancheId: string;
  symbol: string;
  name: string;
  grantName: string;
  vestDate: string;
  units: number;
  netUnits: number;
  grossValueBase: number | null;
  netValueBase: number | null;
  daysUntilVest: number;
}

export interface RsuYearBreakdown {
  year: string;
  units: number;
  grossValueBase: number;
  netValueBase: number;
  vestedValueBase: number;
  unvestedValueBase: number;
}

export interface RsuSummary {
  grantCount: number;
  heldValueBase: number;
  includedHeldValueBase: number;
  unvestedGrossValueBase: number;
  unvestedNetValueBase: number;
  next12mGrossValueBase: number;
  next12mNetValueBase: number;
  nextVest: UpcomingRsuVest | null;
  upcomingTranches: UpcomingRsuVest[];
  byYear: RsuYearBreakdown[];
}

export interface ParsedEmailTx {
  amount: number | null; // major units, negative = expense, positive = income
  currency: string;
  amountBase: number | null;
  payee: string | null;
  date: string; // YYYY-MM-DD
  accountId: string | null;
  categoryId: string | null;
  notes: string;
  confidence: number;
  matchedRuleName: string | null;
  direction: 'expense' | 'income';
  // --- added by the fingerprint parser (absent on events parsed before it) ---
  /** The card/account/wallet the alert is about, e.g. "UOB card ••1234". */
  accountRef?: EmailAccountRef | null;
  /** The other side's account digits, if the alert shows them. */
  counterRef?: EmailAccountRef | null;
  /** Fallback fingerprint for alerts without digits (sender + normalised subject). */
  alertKey?: string;
  /** Where accountId came from. */
  accountSource?: 'link' | 'alert' | 'rule' | 'default' | null;
  /** Set when the other side is one of your own accounts → record as a transfer. */
  transferAccountId?: string | null;
  /** True when amountBase is a conversion at today's rate (foreign currency). */
  fxEstimated?: boolean;
  /** Payee exactly as the bank wrote it; sent to Actual as imported_payee so payee rules match. */
  rawPayee?: string | null;
  /** Set when an Actual rename rule mapped rawPayee to an existing payee. */
  payeeFromRule?: boolean;
  /** The bank's own sender (after unwrapping a hand-forwarded email). */
  originalSender?: string;
}

export interface EmailAccountRef {
  fingerprint: string;
  kind: 'card' | 'account' | 'wallet';
  label: string;
}

export interface AccountLink {
  fingerprint: string;
  kind: 'card' | 'account' | 'wallet' | 'alert';
  label: string;
  accountId: string;
  source: 'learned' | 'manual';
  conflicts: number;
  updatedAt: string;
}

export interface EmailEventRecord {
  id: string;
  source: string;
  message_id: string;
  sender: string;
  subject: string;
  body_text: string;
  received_at: string;
  status: 'queued' | 'pending_review' | 'imported' | 'dismissed' | 'failed';
  parsed: ParsedEmailTx | null;
  confidence: number;
  actual_tx_id: string | null;
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface EmailRuleRecord {
  id: string;
  name: string;
  sender_pattern: string;
  subject_pattern: string;
  amount_regex: string;
  payee_regex: string;
  default_currency: string;
  actual_account_id: string | null;
  actual_category_id: string | null;
  auto_import: boolean;
  enabled: boolean;
  created_at: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface SnapshotPoint {
  date: string;
  investments: number;
  cash: number;
  netWorth: number;
}

export interface OverviewResponse {
  baseCurrency: string;
  actualConnected: boolean;
  actualError?: string;
  budgetName: string | null;
  budgetSyncId: string | null;
  netWorth: {
    total: number;
    actualCash: number;
    actualOffBudgetUnlinked: number;
    investments: number;
    dayChangeBase: number;
    dayChangePct: number;
  };
  accounts: (ActualAccount & { linkedPortfolioValue?: number })[];
  accountGroups?: Array<{ id: string; name: string }>;
  upcomingSchedules: EnrichedSchedule[];
  pendingInboxCount: number;
  snapshots: SnapshotPoint[];
  refreshedAt: string;
}

// --- Zod Schemas ---

const holdingBaseSchema = z.object({
  symbol: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'cash']),
  provider_id: z.string().trim().min(1).max(100),
  quantity: z.number().min(0),
  avg_cost: z.number().min(0),
  currency: z.string().trim().min(3).max(6).default('USD'),
  actual_account_id: z.string().trim().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const holdingInputSchema = holdingBaseSchema.refine(
  (d) => d.asset_type === 'cash' || d.quantity > 0,
  { message: 'Quantity must be greater than 0' },
);

export const holdingUpdateSchema = holdingBaseSchema.partial();

const rsuTrancheBaseSchema = z.object({
  id: z.string().trim().min(1).optional(),
  vest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date'),
  units: z.number().positive('Units must be greater than 0'),
  status: z.enum(['scheduled', 'vested', 'sold', 'forfeited']).default('scheduled'),
  vested_price: z.number().min(0).nullable().optional(),
  withheld_units: z.number().min(0).default(0),
  notes: z.string().max(300).nullable().optional(),
});

export const rsuTrancheInputSchema = rsuTrancheBaseSchema.refine((t) => t.withheld_units <= t.units, {
  message: 'Withheld units cannot exceed tranche units',
});

export const rsuTrancheUpdateSchema = rsuTrancheBaseSchema
  .omit({ id: true })
  .partial()
  .refine(
    (t) =>
      t.units === undefined || t.withheld_units === undefined || t.withheld_units <= t.units,
    { message: 'Withheld units cannot exceed tranche units' },
  );

export const rsuGrantInputSchema = z.object({
  symbol: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
  provider_id: z.string().trim().min(1).max(100),
  grant_name: z.string().trim().max(120).default(''),
  grant_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date'),
  grant_price: z.number().min(0).default(0),
  currency: z.string().trim().min(3).max(6).default('USD'),
  tax_withhold_pct: z.number().min(0).max(99).default(0),
  include_in_total: z.boolean().default(true),
  actual_account_id: z.string().trim().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  tranches: z.array(rsuTrancheInputSchema).min(1, 'Add at least one vesting tranche').max(120),
});

export const rsuGrantUpdateSchema = rsuGrantInputSchema.partial();

export const recurConfigSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endMode: z.enum(['never', 'after_n_occurrences', 'on_date']).default('never'),
  endOccurrences: z.number().int().min(1).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  skipWeekend: z.boolean().optional(),
  weekendSolveMode: z.enum(['before', 'after']).optional(),
});

export const scheduleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  account: z.string().trim().min(1),
  payee: z.string().trim().nullable().optional(),
  payeeName: z.string().trim().max(100).optional(),
  amount: z.number(), // major units (negative = expense, positive = income)
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).default('is'),
  posts_transaction: z.boolean().default(false),
  date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recurConfigSchema]),
});

export const emailEventIngestSchema = z.object({
  source: z.string().trim().min(1).max(64).default('webhook'),
  message_id: z.string().trim().min(1).max(255).optional(),
  from: z.string().trim().max(255).default(''),
  subject: z.string().trim().max(500).default(''),
  text: z.string().max(200_000).default(''),
  html: z.string().max(300_000).optional(),
  received_at: z.string().optional(),
});

export const directTransactionIngestSchema = z.object({
  account_id: z.string().trim().optional(),
  account_name: z.string().trim().optional(),
  amount: z.number(), // major units, negative = expense, positive = income
  currency: z.string().trim().min(3).max(6).optional(),
  payee: z.string().trim().min(1).max(120),
  category_id: z.string().trim().optional(),
  category_name: z.string().trim().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional(),
  cleared: z.boolean().default(true),
  external_id: z.string().trim().max(160).optional(),
});

export const emailRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sender_pattern: z.string().max(200).default(''),
  subject_pattern: z.string().max(200).default(''),
  amount_regex: z.string().max(300).default(''),
  payee_regex: z.string().max(300).default(''),
  default_currency: z.string().trim().min(3).max(6).default('SGD'),
  actual_account_id: z.string().trim().nullable().optional(),
  actual_category_id: z.string().trim().nullable().optional(),
  auto_import: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

// --- Appearance (Night Cards colour schemes) ---

export const appearanceSchema = z.object({
  base: z.enum(['midnight', 'graphite', 'oled', 'day']).default('midnight'),
  accent: z.enum(['lime', 'lilac', 'coral', 'aqua', 'amber', 'pink', 'custom']).default('lime'),
  custom: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#4F8CFF'),
  tiles: z.enum(['colour', 'tinted', 'mono']).default('colour'),
  followSystem: z.boolean().default(false),
});

export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = {
  base: 'midnight',
  accent: 'lime',
  custom: '#4F8CFF',
  tiles: 'colour',
  followSystem: false,
};

// --- Push Notifications ---

export const notificationPrefsSchema = z.object({
  enabled: z.boolean().default(true),
  emailTransactions: z.boolean().default(true),
  emailMode: z.enum(['all', 'review_only', 'imported_only']).default('all'),
  scheduledPosted: z.boolean().default(true),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  emailTransactions: true,
  emailMode: 'all',
  scheduledPosted: true,
};

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(10).max(512),
  }),
  deviceLabel: z.string().trim().max(100).optional(),
});

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  device_label: string;
  created_at: string;
  last_used_at: string | null;
  last_error: string | null;
}

export interface NotificationsStatusResponse {
  vapidPublicKey: string;
  prefs: NotificationPrefs;
  subscriptions: PushSubscriptionRecord[];
}

export interface RecentTransaction extends ActualTransaction {
  accountName: string;
  payeeName: string;
  categoryName: string | null;
  isTransfer: boolean;
}

// --- Monthly envelope budget (all amounts in cents) ---

export interface BudgetCategory {
  id: string;
  name: string;
  /** Assigned this month. */
  budgeted: number;
  /** Spent this month, as a positive number (refunds can make it negative). */
  spent: number;
  /** Left to spend, including carry-in from previous months; negative = overspent. */
  balance: number;
  carryover: boolean;
}

export interface BudgetGroup {
  id: string;
  name: string;
  isIncome: boolean;
  budgeted: number;
  spent: number;
  balance: number;
  /** Income groups only: received this month. */
  received: number;
  categories: BudgetCategory[];
}

export interface BudgetMonthResponse {
  month: string; // YYYY-MM
  months: string[];
  toBudget: number;
  totalBudgeted: number;
  totalSpent: number;
  totalBalance: number;
  totalIncome: number;
  overspentCount: number;
  groups: BudgetGroup[];
}

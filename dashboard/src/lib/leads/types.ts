// ============================================================
// src/lib/leads/types.ts — Shared types for lead source layer
// ============================================================

export interface RawProspect {
  name: string;
  category?: string;
  city?: string;
  country?: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  socialLinks?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    twitter?: string;
    tiktok?: string;
  };
  description?: string;
  source: string;
  sourceUrl?: string;
}

export interface SearchInput {
  city: string;
  country?: string;
  category?: string;
  keywords?: string;
  radius?: number;
  // optional user-provided context
  offerDescription?: string;
}

export interface LeadSourceAdapter {
  name: string;
  description: string;
  /** Returns true if the adapter is configured (has API keys etc.) */
  isConfigured(): Promise<boolean>;
  /** Search for prospects given the input */
  search(input: SearchInput): Promise<RawProspect[]>;
}

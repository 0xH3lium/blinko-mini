export type ItemType = 'blink' | 'note';
export type ItemStatus = 'active' | 'archived';

export interface Item {
  id: string;
  type: ItemType;
  title: string | null;
  content: string;
  status: ItemStatus;
  isPinned: boolean;
  meta: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface ItemFilters {
  type?: ItemType;
  status?: ItemStatus;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ItemPage {
  items: Item[];
  total: number;
}

export interface TagResponse {
  tags: TagCount[];
}

export interface FilterState {
  type?: ItemType;
  status: ItemStatus;
  tag: string | null;
  q: string;
}

export interface CreateItemInput {
  type?: ItemType;
  title?: string | null;
  content: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface UpdateItemInput {
  type?: ItemType;
  title?: string | null;
  content?: string;
  status?: ItemStatus;
  isPinned?: boolean;
  tags?: string[];
  meta?: Record<string, unknown>;
}

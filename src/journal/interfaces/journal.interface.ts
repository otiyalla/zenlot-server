export interface IJournal {
  id: string;
  userId: string;
  symbol: string;
  plainText?: string;
  editorState?: string;
  author?: object;
  tradeId?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  isPinned?: boolean;
  isArchived?: boolean;
}

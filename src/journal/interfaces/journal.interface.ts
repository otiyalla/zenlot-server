export interface IJournal {
    id: number;
    userId: number;
    symbol: string;
    plainText?: string;
    editorState?: string;
    author?: object;
    tradeId?: number;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
    isPinned?: boolean;
    isArchived?: boolean;
}
export interface IJournal {
    id: number;
    userId: number;
    symbol: string;
    plainText?: string;
    editorState?: string;
    author: object;
    createdAt: Date;
    updatedAt: Date;
    isPinned: boolean;
    isArchived: boolean;
}
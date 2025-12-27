export interface AuthenticatedUser {
    id: number;
    fname: string;
    lname: string;
    email: string;
    language: string;
    role: string;
    accountCurrency: string;
    theme: string;
    timezone: string;
    togglePipValue: boolean;
    rules: {
        forex: {
            take_profit: { pips: number}[];
            stop_loss: { pips: number}[];
            lot_size?: number;
        }
    };
    isAuthenticated?: boolean;
}
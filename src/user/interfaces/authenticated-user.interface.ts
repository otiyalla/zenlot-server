export interface AuthenticatedUser {
    id: number;
    fname: string;
    lname: string;
    email: string;
    language: string;
    role: string;
    accountCurrency: string;
    rules: {
    forex: {
        take_profit: { pips: number}[];
        stop_loss: { pips: number}[];
    }
    };
    isAuthenticated?: boolean;
}
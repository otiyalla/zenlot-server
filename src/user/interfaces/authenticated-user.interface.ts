export interface AuthenticatedUser {
  id: string;
  fname: string;
  lname: string;
  email: string;
  language: string;
  role: string;
  accountCurrency: string;
  theme: string;
  timezone: string;
  togglePipValue: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  authVersion: number;
  rules: {
    forex: {
      take_profit: { pips: number }[];
      stop_loss: { pips: number }[];
      lot_size?: number;
    };
  };
  isAuthenticated?: boolean;
}

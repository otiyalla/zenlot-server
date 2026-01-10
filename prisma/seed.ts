import { PrismaClient } from '../generated/prisma/client';
//import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();
  
(async () => {
  // You must provide a unique 'id' for the where clause as required by your generated Prisma types.
  // If you want to use email as a unique field, update your Prisma schema and regenerate the client.
  // For now, using a hardcoded id for demonstration:
  const demoUser = await prisma.user.upsert({
    where: { id: 'ert-765-ert-rtf-765-rtf' },
    create: { 
      id: 'ert-765-ert-rtf-765-rtf', 
      email: 'demo@zenlot.io', 
      fname: 'Demo User', 
      lname: 'User', 
      role: 'free',
      language: 'en', 
      accountCurrency: 'USD',
      password: 'eqwtsurlf',
      rules: {
        forex: {
            takeProfit: [{ pips: 40 }, { pips: 50 }, { pips: 60 }],
            stopLoss: [{ pips: 40 }, { pips: 50 }, { pips: 60 }],
        }
      },
      //togglePipValue: false,
    },
    update: {},
  });

  /*
  await prisma.trade.create({
    data: {
      userId: {  connect: {id: demoUser.id}},
      symbol: 'EURUSD',
      entry: 1.12345,
      lot: 0.01,
      pips: 0.0001,
      exchangeRate: 1.0, 
      execution: 'buy',
      stopLoss: {value: 1.11800, pips: 50},
      takeProfit: {value: 1.12800, pips: 50},
      plainText: '',
      editorState: null,
      status: 'open',
    },
  });
  */

  await prisma.$disconnect();
})();
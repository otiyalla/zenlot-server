import { Injectable } from '@nestjs/common';
import { config } from 'src/config/config.constant';
import axios from 'axios';
import { ListQuotesDto, AvailableSymbols, fmpList } from './dto/quote-list.dto';
import { Server } from 'socket.io';

//const forex_url = 'https://financialmodelingprep.com/api/v3';
const forex_url = 'https://financialmodelingprep.com/stable';
const finhub = config.finhub_api_key;
@Injectable()
export class QuoteService {
    server: Server;


    async getFMPList(): Promise<fmpList[]>{
        const url = `${forex_url}/forex-list?apikey=${config.fmp_api_key}`;
        try {
            const { data } = await axios.get(url);
            return data;
        } catch (error) {
            console.error('Error fetching available forex:', error);
            throw new Error('Failed to fetch available forex');   
        }
    }

    // This service can be expanded to include methods for fetching quotes, processing data, etc.
    // For now, it serves as a placeholder for future functionality related to quotes.
    async getAvailableForex(): Promise<AvailableSymbols[]> {
        let data:AvailableSymbols[] = [];
       
        try {
            const available = await this.getFMPList();
            if (available.length){
                data = available.map(data => {
                    return {
                        symbol: data.symbol,
                        currency: data.toCurrency
                    }
                })
            }
            return data;

        } catch (error) {
            //console.error('Error fetching available forex:', error);
            if (error){
                //data = 
                data = []
            }
            if(!data.length) {
                console.error('Error fetching available forex:', error);
                throw new Error('Failed to fetch available forex');   
            
            }else return data;

        }

    }

    async search (query: string): Promise<AvailableSymbols[]> {
        const quotes = await this.getAvailableForex();
        return quotes.filter(item =>
            item.symbol.toLowerCase().includes(query.toLowerCase()) ||
            item.currency.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        )
    }
    
    async quote(symbol: string){
         try {
            const url = `${forex_url}/quote?symbol=${symbol}&apikey=${config.fmp_api_key}`
            
            const { data } = await axios.get(url);
            return data;
            
        } catch (error) {
            console.error(`Error fetching price for ${symbol}:`, error);
            throw error; // Re-throw to let Bull handle retries or failures
        }
    }

}

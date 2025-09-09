import { Injectable } from '@nestjs/common';
import { config } from 'src/config/config.constant';
import axios from 'axios';
import { ListQuotesDto } from './dto/quote-list.dto';
import { Server } from 'socket.io';

const forex_url = 'https://financialmodelingprep.com/api/v3';
@Injectable()
export class QuoteService {
    server: Server;

    // This service can be expanded to include methods for fetching quotes, processing data, etc.
    // For now, it serves as a placeholder for future functionality related to quotes.
    async getAvailableForex(): Promise<ListQuotesDto[]> {
        const url = `${forex_url}/symbol/available-forex-currency-pairs?apikey=${config.fmp_api_key}`;
        try {
            const { data } = await axios.get(url);
            //const data = []
            return data;

        } catch (error) {
            console.error('Error fetching available forex:', error);
            throw new Error('Failed to fetch available forex');   
        }

    }

    async search (query: string): Promise<ListQuotesDto[]> {
        const quotes = await this.getAvailableForex();
        return quotes.filter(item =>
            item.symbol.toLowerCase().includes(query.toLowerCase()) ||
            item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        )
    }

    async quote(symbol: string){
         try {
            const url = `${forex_url}/fx/${symbol}?apikey=${config.fmp_api_key}`
            const { data } = await axios.get(url);
            return data;
            
        } catch (error) {
            console.error(`Error fetching price for ${symbol}:`, error);
            throw error; // Re-throw to let Bull handle retries or failures
        }
    }

}

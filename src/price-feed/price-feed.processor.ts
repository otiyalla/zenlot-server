//import { Process, Processor } from '@nestjs/bull';

import { Processor, WorkerHost, OnQueueEvent } from '@nestjs/bullmq';
import Redis from 'ioredis';
import axios from 'axios';
import { Job } from 'bullmq';
import { config } from 'src/config/config.constant';
import { fmp } from "financialmodelingprep";

@Processor('price-feed')
export class PriceFeedProcessor extends WorkerHost {
    private publisher = new Redis({
        port: Number(config.redis_port),
        host: config.redis_host,
        keepAlive: 1000, // Optional: keep the connection alive
        lazyConnect: true,
        commandTimeout: 10000, // Set a command timeout if needed
    });

    
    async process(job: Job): Promise<any> {
        const { name } = job;

        if (name === 'price-feed') {
            const symbol = job.data.symbol;
            try {
                const url = `https://financialmodelingprep.com/api/v3/fx/${symbol}?apikey=${config.fmp_api_key}`
                const response = await axios.get(url);
                
                // Publish the price to the Redis channel
                const {data} = response; // Adjust based on actual API response structure
                await this.publisher.publish('price-feed', JSON.stringify(data));
                return data;
              
            } catch (error) {
                console.error(`Error fetching price for ${symbol}:`, error);
                throw error; // Re-throw to let Bull handle retries or failures
            }   
        }
        return null;
    }
}